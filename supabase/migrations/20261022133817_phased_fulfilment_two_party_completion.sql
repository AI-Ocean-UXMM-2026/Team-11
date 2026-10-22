begin;
-- The existing status is the current delivery's lifecycle. A separate persisted
-- marker keeps the public order status stable while later deliveries proceed.
alter table public.orders add column remaining_at timestamptz;
alter table public.orders drop constraint orders_check1;
alter table public.orders add constraint orders_done_receipt check(status<>'Done' or (sme_received_at is not null and done_at is not null and not has_open_issue));
create table supplylink_private.fulfilment_phases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  number integer not null check(number>0),
  source_branch_id uuid references public.branches(id),
  handoff_id uuid unique references public.delivery_handoffs(id),
  attempt_id uuid unique references public.delivery_attempts(id),
  state text not null check(state in ('requested','reserved','dispatched','received','cancelled')),
  sme_received_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(order_id,number)
);
create unique index one_open_fulfilment_phase on supplylink_private.fulfilment_phases(order_id) where state in ('requested','reserved','dispatched');
create index fulfilment_phases_source on supplylink_private.fulfilment_phases(source_branch_id);
create table supplylink_private.fulfilment_phase_lines (
  phase_id uuid not null references supplylink_private.fulfilment_phases(id),
  product_id uuid not null references public.products(id),
  quantity integer not null check(quantity between 1 and 1000000),
  primary key(phase_id,product_id)
);
create index fulfilment_phase_lines_product on supplylink_private.fulfilment_phase_lines(product_id);
alter table supplylink_private.fulfilment_phases enable row level security;
alter table supplylink_private.fulfilment_phase_lines enable row level security;
revoke all on supplylink_private.fulfilment_phases,supplylink_private.fulfilment_phase_lines from public,anon,authenticated;

create function supplylink_private.order_status_label(o public.orders) returns text
language sql immutable set search_path='' as $$
 select case when o.remaining_at is not null and o.status not in ('Done','Cancelled') then 'Order remaining' else o.status::text end;
$$;
revoke all on function supplylink_private.order_status_label(public.orders) from public,anon,authenticated;

create function supplylink_private.phase_progress(p_order uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when not exists(select 1 from supplylink_private.fulfilment_phases where order_id=p_order) then null else
 jsonb_build_object('deliveryStatus',o.status,'ordered',o.item_count,
  'received',coalesce((select sum(l.quantity) from supplylink_private.fulfilment_phases p join supplylink_private.fulfilment_phase_lines l on l.phase_id=p.id where p.order_id=o.id and p.sme_received_at is not null),0),
  'remaining',o.item_count-coalesce((select sum(l.quantity) from supplylink_private.fulfilment_phases p join supplylink_private.fulfilment_phase_lines l on l.phase_id=p.id where p.order_id=o.id and p.sme_received_at is not null),0),
  'current',(select jsonb_build_object('id',p.id,'number',p.number,'state',p.state,'sourceBranchId',p.source_branch_id,
    'source',coalesce(b.name,'STT Yangon HQ'),'received',p.sme_received_at is not null,'attemptId',p.attempt_id,
    'pairs',(select sum(quantity) from supplylink_private.fulfilment_phase_lines where phase_id=p.id),
    'lines',(select jsonb_agg(jsonb_build_object('productId',l.product_id,'quantity',l.quantity,'name',ol.product_name,'variant',ol.pack_snapshot) order by l.product_id)
      from supplylink_private.fulfilment_phase_lines l join public.order_lines ol on ol.order_id=p.order_id and ol.product_id=l.product_id where l.phase_id=p.id))
    from supplylink_private.fulfilment_phases p left join public.branches b on b.id=p.source_branch_id where p.order_id=o.id and p.state in ('requested','reserved','dispatched')),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'source',coalesce(b.name,'STT Yangon HQ'),'state',p.state,
    'pairs',(select sum(quantity) from supplylink_private.fulfilment_phase_lines where phase_id=p.id),
    'received',p.sme_received_at is not null,'handover',a.status='handed_over','completedAt',p.completed_at) order by p.number)
    from supplylink_private.fulfilment_phases p left join public.branches b on b.id=p.source_branch_id left join public.delivery_attempts a on a.id=p.attempt_id where p.order_id=o.id),'[]'::jsonb),
  'lines',(select jsonb_agg(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'ordered',l.quantity,
    'received',coalesce((select sum(pl.quantity) from supplylink_private.fulfilment_phase_lines pl join supplylink_private.fulfilment_phases p on p.id=pl.phase_id where p.order_id=o.id and pl.product_id=l.product_id and p.sme_received_at is not null),0)) order by l.product_id) from public.order_lines l where l.order_id=o.id)
 ) end from public.orders o where o.id=p_order;
$$;
revoke all on function supplylink_private.phase_progress(uuid) from public,anon,authenticated;

create or replace function public.workflow_finish(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; phase supplylink_private.fulfilment_phases; finished integer;
begin
 select * into o from public.orders where id=p_order for update;
 if o.id is null or o.has_open_issue or o.status in ('Done','Cancelled') then return; end if;
 if exists(select 1 from supplylink_private.fulfilment_phases where order_id=o.id) then
   select * into phase from supplylink_private.fulfilment_phases where order_id=o.id and state='dispatched' for update;
   if phase.id is null or phase.sme_received_at is null or not exists(select 1 from public.delivery_attempts where id=phase.attempt_id and status='handed_over') then return; end if;
   update supplylink_private.fulfilment_phases set state='received',completed_at=clock_timestamp() where id=phase.id;
   update public.delivery_attempts set active=false where id=phase.attempt_id;
   select coalesce(sum(l.quantity),0) into finished from supplylink_private.fulfilment_phases p join supplylink_private.fulfilment_phase_lines l on l.phase_id=p.id where p.order_id=o.id and p.state='received';
   if finished<o.item_count then
     update public.orders set remaining_at=coalesce(remaining_at,clock_timestamp()),status='Confirmed',source_branch_id=null,source_name='STT Yangon HQ',
       dispatched_at=null,handoff_pending=false,sme_received_at=null where id=o.id;
     return;
   end if;
   update public.orders set sme_received_at=phase.sme_received_at where id=o.id;
 else
   if o.sme_received_at is null or not exists(select 1 from public.delivery_attempts where order_id=o.id and active and status='handed_over') then return; end if;
 end if;
 update public.orders set status='Done',done_at=coalesce(done_at,clock_timestamp()) where id=o.id;
 insert into public.sales_events(reference,channel,order_id,merchandise,units,occurred_at)
   values(o.reference,'Wholesale',o.id,o.merchandise_total,o.item_count,clock_timestamp()) on conflict(order_id) do nothing;
 update public.delivery_attempts set active=false where order_id=o.id and active;
end; $$;
revoke all on function public.workflow_finish(uuid) from public,anon,authenticated;

alter function public.workflow_execute(text,jsonb,uuid) rename to workflow_execute_before_phases;
alter function public.workflow_execute_before_phases(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_before_phases(text,jsonb,uuid) from public,anon,authenticated;

create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<phase_workflow>>
declare actor public.profiles:=supplylink_private.workspace_actor(); o public.orders; phase supplylink_private.fulfilment_phases;
  cached public.workflow_operations; result jsonb; fingerprint text; driver uuid; target uuid; qty integer; outstanding integer; total integer:=0;
  item jsonb; line record; inv public.inventory; b public.branches; hand public.delivery_handoffs; attempt public.delivery_attempts; reason text;
begin
 if p_key is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>20000 then raise exception 'Operation, payload and retry key are required.'; end if;
 target:=nullif(p_payload->>'orderId','')::uuid;
 -- Always acquire the driver's GPS lock before order/inventory locks.
 if target is not null then
   select driver_id into driver from public.delivery_attempts where order_id=target and active limit 1;
   if driver is not null then perform pg_advisory_xact_lock(hashtextextended('delivery-gps:'||driver::text,0)); end if;
 end if;
 fingerprint:=md5(p_action||p_payload::text);
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
 select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
 if found then
   if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
   return cached.result;
 end if;
 if target is not null then
   select * into o from public.orders where id=target for update;
   if o.id is null then raise exception 'Order not found.'; end if;
   if not exists(select 1 from supplylink_private.scoped_orders(actor) x where x.id=o.id) then raise exception 'This order is unavailable.' using errcode='42501'; end if;
   select * into phase from supplylink_private.fulfilment_phases where order_id=o.id and state in ('requested','reserved','dispatched') for update;
   if p_payload->>'phaseId' is not null and (phase.id is null or phase.id is distinct from (p_payload->>'phaseId')::uuid) then raise exception 'This phase changed. Refresh the order before continuing.'; end if;
 end if;
 reason:=trim(coalesce(p_payload->>'reason',''));
 if p_action='phase_request' then
   if actor.role<>'hq' or o.id is null or o.status not in ('Confirmed','Preparing') or o.source_branch_id is not null or o.payment_verified_at is null
     or o.reserved_at is null or o.dispatched_at is not null or o.has_open_issue or o.handoff_pending or phase.id is not null
     then raise exception 'HQ can plan the outstanding delivery after the previous phase is received and handed over.'; end if;
   if exists(select 1 from public.delivery_attempts a join supplylink_private.delivery_run_stops s on s.attempt_id=a.id where a.order_id=o.id and a.active) then raise exception 'Remove the existing grouped assignment before changing its parcel quantities.'; end if;
   if length(reason) not between 3 and 500 or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'Select phase quantities and record a reason.'; end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'lines') r group by r->>'productId' having count(*)>1) then raise exception 'Use each size and colour only once.'; end if;
   if nullif(p_payload->>'branchId','') is not null then
     select * into b from public.branches where id=(p_payload->>'branchId')::uuid and active for share;
     if not found then raise exception 'Choose an open branch.'; end if;
   end if;
   perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and (i.branch_id is null or i.branch_id=b.id) order by i.branch_id nulls first,i.product_id for update of i;
   insert into supplylink_private.fulfilment_phases(order_id,number,source_branch_id,state)
     values(o.id,(select coalesce(max(number),0)+1 from supplylink_private.fulfilment_phases where order_id=o.id),b.id,case when b.id is null then 'reserved' else 'requested' end) returning * into phase;
   for item in select value from jsonb_array_elements(p_payload->'lines') loop
     if (item->>'quantity') is null or (item->>'quantity') !~ '^[0-9]+$' then raise exception 'Use whole positive pair quantities.'; end if;
     qty:=(item->>'quantity')::integer;
     select l.quantity-coalesce((select sum(pl.quantity) from supplylink_private.fulfilment_phase_lines pl join supplylink_private.fulfilment_phases p on p.id=pl.phase_id where p.order_id=o.id and p.state='received' and pl.product_id=l.product_id),0)
       into outstanding from public.order_lines l where l.order_id=o.id and l.product_id=(item->>'productId')::uuid;
     if outstanding is null or qty<1 or qty>outstanding then raise exception 'Phase quantities exceed the outstanding order for a size or colour.'; end if;
     select * into inv from public.inventory where branch_id is null and product_id=(item->>'productId')::uuid;
     if inv.id is null or inv.allocated<qty then raise exception 'The HQ reservation for these remaining pairs is unavailable.'; end if;
     if b.id is not null and not exists(select 1 from public.inventory where branch_id=b.id and product_id=(item->>'productId')::uuid and protected_reserve>=qty) then raise exception 'The phase exceeds available wholesale backup stock. Reduce the quantity or choose another source.'; end if;
     insert into supplylink_private.fulfilment_phase_lines values(phase.id,(item->>'productId')::uuid,qty);
     total:=total+qty;
   end loop;
   update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active and status='planned';
   if b.id is not null then
     insert into public.delivery_handoffs(order_id,branch_id,original_resolution,reason,created_by) values(o.id,b.id,'phased_delivery',reason,actor.id) returning * into hand;
     update supplylink_private.fulfilment_phases set handoff_id=hand.id where id=phase.id;
     update public.orders set handoff_pending=true where id=o.id;
   else update public.orders set status='Confirmed' where id=o.id; end if;
   result:=jsonb_build_object('message','Phase '||phase.number||' planned for '||total||' pairs. '||case when b.id is null then 'Assign an HQ driver next.' else 'Waiting for branch acceptance.' end);
 elsif phase.id is not null and p_action in ('handoff_accept','handoff_decline','handoff_cancel','phase_cancel') then
   if p_action='phase_cancel' then
     if actor.role<>'hq' or phase.state='dispatched' or length(reason)<3 then raise exception 'HQ can cancel only an undispatched phase with a reason.'; end if;
   else
     select * into hand from public.delivery_handoffs where id=(p_payload->>'handoffId')::uuid and id=phase.handoff_id and status='pending' for update;
     if hand.id is null or phase.state<>'requested' then raise exception 'This phase request is no longer pending.'; end if;
     if (p_action='handoff_cancel' and actor.role<>'hq') or (p_action in ('handoff_accept','handoff_decline') and (actor.role<>'branch' or actor.branch_id is distinct from phase.source_branch_id)) then raise exception 'Only the requested branch can respond to this phase.' using errcode='42501'; end if;
   end if;
   if p_action='handoff_accept' then
     perform i.id from public.inventory i join supplylink_private.fulfilment_phase_lines l on l.product_id=i.product_id where l.phase_id=phase.id and (i.branch_id is null or i.branch_id=phase.source_branch_id) order by i.branch_id nulls first,i.product_id for update of i;
     for line in select * from supplylink_private.fulfilment_phase_lines where phase_id=phase.id order by product_id loop
       update public.inventory set allocated=allocated-line.quantity where branch_id is null and product_id=line.product_id and allocated>=line.quantity;
       if not found then raise exception 'The HQ reservation changed. Ask HQ to review this phase.'; end if;
       update public.inventory set protected_reserve=protected_reserve-line.quantity,allocated=allocated+line.quantity where branch_id=phase.source_branch_id and product_id=line.product_id and protected_reserve>=line.quantity;
       if not found then raise exception 'Available branch wholesale stock changed. Decline or ask HQ to reduce this phase.'; end if;
       insert into supplylink_private.branch_backup_allocations(order_id,branch_id,product_id,quantity) values(o.id,phase.source_branch_id,line.product_id,line.quantity);
     end loop;
     update public.delivery_handoffs set status='accepted',responded_at=clock_timestamp(),responded_by=actor.id where id=hand.id;
     update supplylink_private.fulfilment_phases set state='reserved' where id=phase.id;
     update public.orders set source_branch_id=phase.source_branch_id,source_name=(select name from public.branches where id=phase.source_branch_id),handoff_pending=false,status='Confirmed' where id=o.id;
     result:=jsonb_build_object('message','Branch reserved only this phase. The remaining order stays reserved at HQ.');
   else
     if length(reason)<3 then raise exception 'Record a reason for declining or cancelling.'; end if;
     if phase.state='reserved' and phase.source_branch_id is not null then
       perform i.id from public.inventory i join supplylink_private.fulfilment_phase_lines l on l.product_id=i.product_id where l.phase_id=phase.id and (i.branch_id is null or i.branch_id=phase.source_branch_id) order by i.branch_id nulls first,i.product_id for update of i;
       for line in select * from supplylink_private.fulfilment_phase_lines where phase_id=phase.id loop
         update public.inventory set allocated=allocated-line.quantity,protected_reserve=protected_reserve+line.quantity where branch_id=phase.source_branch_id and product_id=line.product_id and allocated>=line.quantity;
         if not found then raise exception 'Phase reservation changed.'; end if;
         update public.inventory set allocated=allocated+line.quantity where branch_id is null and product_id=line.product_id;
       end loop;
       delete from supplylink_private.branch_backup_allocations where order_id=o.id;
     end if;
     update supplylink_private.fulfilment_phases set state='cancelled' where id=phase.id;
     update public.delivery_handoffs set status=case when p_action='handoff_decline' then 'declined' else 'cancelled' end,response_reason=phase_workflow.reason,responded_at=clock_timestamp(),responded_by=actor.id where id=phase.handoff_id;
     update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active and status='planned';
     update public.orders set source_branch_id=null,source_name='STT Yangon HQ',handoff_pending=false,status='Confirmed' where id=o.id;
     result:=jsonb_build_object('message','Phase cancelled. Outstanding pairs remain reserved at HQ for replanning.');
   end if;
 elsif phase.id is not null and p_action='dispatch' then
   select * into attempt from public.delivery_attempts where order_id=o.id and active for update;
   if phase.state<>'reserved' or o.status<>'Preparing' or o.has_open_issue or o.handoff_pending or attempt.id is null
     or not(actor.role='hq' or (actor.role='branch' and actor.branch_id=phase.source_branch_id))
     or not exists(select 1 from public.profiles where id=attempt.driver_id and role='driver' and status='active' and not must_change_password and branch_id is not distinct from phase.source_branch_id)
     then raise exception 'Prepare this phase and assign an active source driver before dispatch.'; end if;
   perform i.id from public.inventory i join supplylink_private.fulfilment_phase_lines l on l.product_id=i.product_id where l.phase_id=phase.id and i.branch_id is not distinct from phase.source_branch_id order by i.product_id for update of i;
   for line in select * from supplylink_private.fulfilment_phase_lines where phase_id=phase.id order by product_id loop
     update public.inventory set on_hand=on_hand-line.quantity,allocated=allocated-line.quantity where product_id=line.product_id and branch_id is not distinct from phase.source_branch_id and allocated>=line.quantity;
     if not found then raise exception 'This phase reservation could not be dispatched.'; end if;
     insert into public.inventory_movements(product_id,branch_id,order_id,actor_id,kind,quantity,reason) values(line.product_id,phase.source_branch_id,o.id,actor.id,'phase:'||phase.id::text,-line.quantity,'Wholesale phase '||phase.number);
   end loop;
   delete from supplylink_private.branch_backup_allocations where order_id=o.id;
   update supplylink_private.fulfilment_phases set state='dispatched',attempt_id=attempt.id where id=phase.id;
   update public.delivery_attempts set status='dispatched',dispatched_at=clock_timestamp() where id=attempt.id;
   update public.orders set status='Shipping',dispatched_at=clock_timestamp() where id=o.id;
   result:=jsonb_build_object('message','Only this phase was dispatched. Remaining quantities are unchanged.');
 elsif phase.id is not null and p_action='receive' then
   if actor.role<>'sme' or o.sme_id<>actor.id or phase.state<>'dispatched' or o.has_open_issue or phase.sme_received_at is not null
     or p_payload->>'phaseId' is null or not coalesce((p_payload->>'fullReceipt')::boolean,false)
     then raise exception 'Confirm physical receipt of every pair in this specific phase.'; end if;
   update supplylink_private.fulfilment_phases set sme_received_at=clock_timestamp() where id=phase.id;
   perform public.workflow_finish(o.id);
   result:=jsonb_build_object('message','Receipt recorded for phase '||phase.number||'. The order is Done only after all phases have driver handover and SME receipt.');
 elsif p_action='complete' then
   if actor.role<>'hq' or o.id is null then raise exception 'This order is unavailable.' using errcode='42501'; end if;
   result:=jsonb_build_object('message','HQ completion is no longer required. Driver handover and SME receipt complete the order.');
   insert into public.workflow_operations values(actor.id,p_key,fingerprint,result);
   return result;
 else
   if exists(select 1 from supplylink_private.fulfilment_phases where order_id=target) then
     if p_action='route_branch' then raise exception 'Plan a new phase for outstanding pairs instead of replacing the whole order.'; end if;
     if p_action='cancel' then raise exception 'Cancel the open phase and coordinate the outstanding order with HQ. Delivered pairs cannot be cancelled.'; end if;
     if p_action in ('assign','prepare','dispatch','pickup','handover') and (phase.id is null or phase.state='requested') then raise exception 'Plan and accept the next phase first.'; end if;
     if p_action='handover' and p_payload->>'phaseId' is null then raise exception 'Refresh this phase before confirming its handover.'; end if;
   end if;
   result:=supplylink_private.workflow_execute_before_phases(p_action,p_payload,p_key);
   if phase.id is not null and p_action='assign' then
     update supplylink_private.fulfilment_phases set attempt_id=(select id from public.delivery_attempts where order_id=o.id and active) where id=phase.id;
   end if;
   if p_action in ('handover','resolve') then perform public.workflow_finish(target); end if;
   if p_action='receive' then result:=result||jsonb_build_object('message','SME receipt recorded. Driver handover and receipt complete the order.'); end if;
   update public.workflow_operations set result=phase_workflow.result where actor_id=actor.id and operation_key=p_key;
   return result;
 end if;
 insert into public.order_events(order_id,actor_id,action,reason) values(o.id,actor.id,p_action,case when phase.id is null then reason else 'Phase '||phase.number||case when reason='' then '' else ': '||reason end end);
 insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'workflow.'||p_action,o.id,jsonb_build_object('phaseId',phase.id,'reason',reason));
 insert into public.workflow_operations values(actor.id,p_key,fingerprint,result);
 return result;
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

-- Existing orders already confirmed by both parties no longer wait for HQ.
do $$ declare target uuid; begin
 for target in select o.id from public.orders o where o.status not in ('Done','Cancelled') and o.sme_received_at is not null and not o.has_open_issue
   and exists(select 1 from public.delivery_attempts a where a.order_id=o.id and a.active and a.status='handed_over')
 loop perform public.workflow_finish(target); end loop;
end $$;

create or replace function supplylink_private.workflow_list_before_tracking(p_kind text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  page_number integer:=coalesce((p_query->>'page')::integer,1);
  page_size integer:=coalesce((p_query->>'pageSize')::integer,25);
  row_count bigint; rows_json jsonb; totals jsonb:='{}';
  search_text text:=lower(trim(coalesce(p_query->>'search','')));
  status_filter text:=coalesce(p_query->>'status','All orders');
  selected_id uuid:=nullif(p_query->>'orderId','')::uuid;
  date_from date:=coalesce((p_query->>'reportFrom')::date,date_trunc('month',now() at time zone 'Asia/Yangon')::date);
  date_to date:=coalesce((p_query->>'reportTo')::date,(now() at time zone 'Asia/Yangon')::date);
  channel_filter text:=coalesce(p_query->>'reportChannel','All channels');
  cutoff timestamptz:=coalesce((p_query->>'reportCutoff')::timestamptz,statement_timestamp());
  page_offset bigint;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'Invalid query.'; end if;
  if page_number not between 1 and 1000000 or page_size not in (25,50,100) or length(search_text)>120 then raise exception 'Invalid pagination.'; end if;
  if status_filter not in ('All orders','Draft','Awaiting verification','Confirmed','Preparing','Shipping','On hold','Complete','Done','Cancelled','Order remaining') then raise exception 'Invalid order status.'; end if;
  if date_from>date_to or channel_filter not in ('All channels','Retail','Wholesale') or cutoff>statement_timestamp() then raise exception 'Invalid report selection.'; end if;
  if p_kind='orders' then
    select count(*) into row_count from supplylink_private.scoped_orders(actor) o
      where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
        and (status_filter='All orders' or supplylink_private.order_status_label(o)=status_filter)
        and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer));
    page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'reference',o.reference,'business',o.business_name,'initials',upper(left(o.business_name,2)),
      'location',o.destination,'pin',case when o.latitude is null then null else jsonb_build_object('latitude',o.latitude,'longitude',o.longitude) end,'items',o.item_count,'merchandise',case when actor.role in ('driver','branch') then 0 else o.merchandise_total end,
      'shipping',case when actor.role in ('driver','branch') then 0 else o.shipping_total end,'status',supplylink_private.order_status_label(o),
      'date',to_char(o.created_at at time zone 'Asia/Yangon','YYYY-MM-DD'),
      'salesDate',case when o.done_at is null then null else to_char(o.done_at at time zone 'Asia/Yangon','YYYY-MM-DD') end,'source',o.source_name,
      'workflow',jsonb_build_object('receiver',o.receiver_name,'phone',o.receiver_phone,'notes',o.notes,'paymentVerified',case when actor.role in ('driver','branch') then false else o.payment_verified_at is not null end,
        'reserved',o.reserved_at is not null,'hqComplete',o.hq_completed_at is not null,'received',o.sme_received_at is not null,'issue',o.issue_reason,'refundRequired',o.refund_required,
        'instructions',case when actor.role in ('driver','branch') then '' else o.payment_instructions end,
        'dispatched',o.dispatched_at is not null,'sourceBranchId',o.source_branch_id,'handoffPending',o.handoff_pending,'replacementRequired',o.replacement_required,
        'handoffs',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'branchId',h.branch_id,'branchName',(select name from public.branches where id=h.branch_id),'status',h.status,'resolution',h.original_resolution,'reason',h.reason,'responseReason',h.response_reason,'at',h.created_at) order by h.created_at desc,h.id desc) from public.delivery_handoffs h where h.order_id=o.id),'[]'::jsonb),
        'driverId',case when a.active or o.status in ('Done','Cancelled') then a.driver_id else null end,'driverName',case when a.active or o.status in ('Done','Cancelled') then (select name from public.profiles where id=a.driver_id) else null end,'handover',a.active and a.status='handed_over',
        'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'quantity',l.quantity,'unitPrice',case when actor.role in ('driver','branch') then null else l.unit_price end))) from public.order_lines l where l.order_id=o.id),'[]'::jsonb),
        'evidence',case when actor.role in ('driver','branch') then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'amount',e.claimed_amount,'verifiedAmount',e.verified_amount,'reference',e.transfer_reference,'status',e.status,'reason',e.reason,'createdAt',e.created_at) order by e.version desc) from public.payment_evidence e where e.order_id=o.id),'[]'::jsonb) end,
        'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'reason',ev.reason,'at',ev.created_at,'actor',(select name from public.profiles where id=ev.actor_id)) order by ev.created_at,ev.id) from public.order_events ev where ev.order_id=o.id),'[]'::jsonb)
      )) order by o.created_at desc,o.id desc),'[]'::jsonb) into rows_json
      from (select * from supplylink_private.scoped_orders(actor) o
        where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
          and (status_filter='All orders' or supplylink_private.order_status_label(o)=status_filter)
          and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0)
        order by o.created_at desc,o.id desc limit page_size offset page_offset) o
      left join lateral (select * from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1) a on true;
  elsif p_kind='retail' then
    if actor.role not in ('hq','branch') then raise exception 'Retail history is restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',s.reference,'branchId',s.branch_id,'description',coalesce((select string_agg(p.name||' · '||p.pack,', ') from public.retail_sale_lines l join public.products p on p.id=l.product_id where l.sale_id=s.id),'Retail sale'),'amount',s.merchandise_total,'packs',coalesce((select sum(quantity) from public.retail_sale_lines where sale_id=s.id),0),'date',to_char(s.confirmed_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by s.confirmed_at desc,s.id desc),'[]'::jsonb) into rows_json
      from (select * from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id order by s.confirmed_at desc,s.id desc limit page_size offset page_offset) s;
  elsif p_kind='transfers' then
    if actor.role not in ('hq','branch') then raise exception 'Transfers are restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'sourceBranchId',t.source_branch_id,'destinationBranchId',t.destination_branch_id,'source',coalesce((select name from public.branches where id=t.source_branch_id),'STT Yangon HQ'),'destination',coalesce((select name from public.branches where id=t.destination_branch_id),'STT Yangon HQ'),'productId',t.product_id,'variant',(select pack from public.products where id=t.product_id),'quantity',t.quantity,'status',t.status,'reason',t.reason,'createdAt',t.created_at) order by t.created_at desc,t.id desc),'[]'::jsonb) into rows_json
      from (select * from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id order by t.created_at desc,t.id desc limit page_size offset page_offset) t;
  elsif p_kind='report' then
    if actor.role not in ('hq','branch') then raise exception 'Sales reports are restricted to HQ and branch staff.'; end if;
    select count(*),jsonb_build_object('wholesale',coalesce(sum(e.merchandise) filter(where e.channel='Wholesale'),0),'retail',coalesce(sum(e.merchandise) filter(where e.channel='Retail'),0)) into row_count,totals
      from public.sales_events e
      where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
        and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
        and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'reference',e.reference,'orderId',e.order_id,'channel',e.channel,'amount',e.merchandise,'units',e.units,'branchId',e.branch_id,'date',to_char(e.occurred_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into rows_json
      from (select * from public.sales_events e
        where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
          and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
          and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter)
        order by e.occurred_at desc,e.id desc limit page_size offset page_offset) e;
  else raise exception 'Unknown list.';
  end if;
  return jsonb_build_object('rows',rows_json,'total',row_count,'page',page_number,'pageSize',page_size,'summary',totals,'cutoff',cutoff);
end; $$;

revoke all on function supplylink_private.workflow_list_before_tracking(text,jsonb) from public,anon,authenticated;

alter function public.workflow_list(text,jsonb) rename to workflow_list_before_phases;
alter function public.workflow_list_before_phases(text,jsonb) set schema supplylink_private;
revoke all on function supplylink_private.workflow_list_before_phases(text,jsonb) from public,anon,authenticated;
create function public.workflow_list(p_kind text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); result jsonb; rows jsonb:='[]'; row jsonb; progress jsonb;
begin
 result:=supplylink_private.workflow_list_before_phases(p_kind,p_query);
 if p_kind<>'orders' then return result; end if;
 for row in select value from jsonb_array_elements(result->'rows') loop
   progress:=supplylink_private.phase_progress((row->>'id')::uuid);
   if progress is not null then
     row:=jsonb_set(row,'{workflow,fulfilment}',progress);
     if actor.role in ('driver','branch') and progress->'current' is distinct from 'null'::jsonb then
       row:=jsonb_set(row,'{items}',progress->'current'->'pairs');
       row:=jsonb_set(row,'{workflow,lines}',progress->'current'->'lines');
     end if;
   end if;
   rows:=rows||jsonb_build_array(row);
 end loop;
 return jsonb_set(result,'{rows}',rows);
end; $$;
revoke all on function public.workflow_list(text,jsonb) from public,anon;
grant execute on function public.workflow_list(text,jsonb) to authenticated;
create or replace function public.driver_delivery_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); result jsonb;
begin
  if actor.role<>'driver' then raise exception 'Only drivers can view their pickup groups.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(g.data order by g.created_at,g.id),'[]'::jsonb) into result from (
    select r.id,r.created_at,jsonb_build_object('id',r.id,'acceptedAt',r.accepted_at,
      'sourceName',coalesce(b.name,'STT Yangon HQ'),'stops',(
        select jsonb_agg(jsonb_build_object('orderId',o.id,'attemptId',a.id,'position',s.position,
          'reference',o.reference,'business',o.business_name,'pairs',coalesce((select sum(pl.quantity) from supplylink_private.fulfilment_phase_lines pl join supplylink_private.fulfilment_phases ph on ph.id=pl.phase_id where ph.attempt_id=a.id),o.item_count),'status',o.status,
          'pickedUpAt',a.picked_up_at,'active',a.active and a.driver_id=actor.id,
          'canPickup',a.active and a.driver_id=actor.id and a.status='dispatched' and a.picked_up_at is null
            and o.status='Shipping' and not o.has_open_issue and not o.handoff_pending and not o.replacement_required,
          'canDeliver',a.active and a.driver_id=actor.id and a.status='dispatched' and a.picked_up_at is not null
            and o.status='Shipping' and not o.has_open_issue and not o.handoff_pending and not o.replacement_required
        ) order by s.position) from supplylink_private.delivery_run_stops s
        join public.delivery_attempts a on a.id=s.attempt_id join public.orders o on o.id=a.order_id
        where s.run_id=r.id and a.driver_id=actor.id
      )) data from supplylink_private.delivery_runs r left join public.branches b on b.id=r.source_branch_id
    where r.driver_id=actor.id and exists(select 1 from supplylink_private.delivery_run_stops s
      join public.delivery_attempts a on a.id=s.attempt_id join public.orders o on o.id=a.order_id
      where s.run_id=r.id and a.active and a.driver_id=actor.id and a.status in ('planned','dispatched','held')
        and o.status not in ('Complete','Done','Cancelled'))
  ) g;
  return result;
end; $$;
revoke all on function public.driver_delivery_groups() from public,anon;
grant execute on function public.driver_delivery_groups() to authenticated;



-- Planning uses actual phase quantities, never the entire parent order twice.
create function supplylink_private.wholesale_demand_lines()
returns table(order_id uuid,branch_id uuid,created_at timestamptz,product_id uuid,quantity integer,accepted boolean)
language sql stable security definer set search_path='' as $$
 with legacy as (
  select distinct on(h.order_id) h.order_id,h.branch_id,min(h.created_at) over(partition by h.order_id) created_at,h.status='accepted' accepted
  from public.delivery_handoffs h left join supplylink_private.backup_declines d on d.handoff_id=h.id
  where (h.status='accepted' or (h.status='declined' and d.cause='stock_shortage'))
   and not exists(select 1 from supplylink_private.fulfilment_phases p where p.handoff_id=h.id)
  order by h.order_id,(h.status='accepted') desc,h.created_at,h.id
 ) select h.order_id,h.branch_id,h.created_at,l.product_id,l.quantity,h.accepted from legacy h join public.order_lines l on l.order_id=h.order_id
 union all
 select p.order_id,p.source_branch_id,p.created_at,l.product_id,l.quantity,true from supplylink_private.fulfilment_phases p
 join supplylink_private.fulfilment_phase_lines l on l.phase_id=p.id
 where p.source_branch_id is not null and p.state in ('reserved','dispatched','received');
$$;
revoke all on function supplylink_private.wholesale_demand_lines() from public,anon,authenticated;
-- Preserve optional historical-sample wrappers while replacing the common,
-- audited operational-demand subquery in both versions of the planner.
do $$ declare fn record; definition text; first_pos integer; end_pos integer; scope_filter text;
begin
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='supplylink_private' and p.proname in ('planning_rows_pre_pools','backup_recommendation')
 loop
   definition:=pg_get_functiondef(fn.oid);
   first_pos:=strpos(definition,'with canonical as (');
   if first_pos=0 then raise exception 'Planning demand definition changed; review before rollout.'; end if;
   end_pos:=strpos(substr(definition,first_pos),'), demand as (');
   if end_pos=0 or strpos(definition,'from canonical h join public.order_lines l on l.order_id=h.order_id')=0 then raise exception 'Planning demand join changed; review before rollout.'; end if;
   scope_filter:=case when fn.proname='backup_recommendation' then ' where accepted and exists(select 1 from public.orders o where o.id=order_id and o.status<>''Cancelled'') ' else '' end;
   definition:=substr(definition,1,first_pos-1)||'with canonical as (select * from supplylink_private.wholesale_demand_lines() '||scope_filter||substr(definition,first_pos+end_pos-1);
   definition:=replace(definition,'from canonical h join public.order_lines l on l.order_id=h.order_id','from canonical h cross join lateral (select h.product_id,h.quantity) l');
   execute definition;
 end loop;
end $$;

alter function supplylink_private.stock_planning_workspace(text,jsonb,uuid) rename to stock_planning_before_phases;
revoke all on function supplylink_private.stock_planning_before_phases(text,jsonb,uuid) from public,anon,authenticated;
create function supplylink_private.stock_planning_workspace(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); phase supplylink_private.fulfilment_phases; result jsonb; rows jsonb;
begin
 if actor.role<>'hq' then raise exception 'Stock planning is restricted to HQ.' using errcode='42501'; end if;
 if p_action='takeover' and exists(select 1 from supplylink_private.fulfilment_phases where order_id=nullif(p_payload->>'orderId','')::uuid) then raise exception 'Use the order phase planner to assign outstanding pairs.'; end if;
 if p_action='cancel_takeover' then
   select * into phase from supplylink_private.fulfilment_phases where handoff_id=nullif(p_payload->>'handoffId','')::uuid and state='requested';
   if found then return public.workflow_execute('handoff_cancel',p_payload||jsonb_build_object('orderId',phase.order_id),p_key); end if;
 end if;
 result:=supplylink_private.stock_planning_before_phases(p_action,p_payload,p_key);
 if p_action='detail' then
  select coalesce(jsonb_agg(r.value||case when p.id is null then '{}'::jsonb else jsonb_build_object('quantity',coalesce((select quantity from supplylink_private.fulfilment_phase_lines where phase_id=p.id and product_id=(p_payload->>'productId')::uuid),0),'status',case p.state when 'requested' then 'pending' when 'reserved' then 'reserved' when 'dispatched' then 'in transit' when 'received' then 'fulfilled' else 'cancelled' end,'fulfilledAt',p.completed_at,'lines',
   (select jsonb_agg(jsonb_build_object('productId',l.product_id,'quantity',l.quantity,'unit','pairs')) from supplylink_private.fulfilment_phase_lines l where l.phase_id=p.id)) end order by r.ordinality),'[]'::jsonb)
   into rows from jsonb_array_elements(result->'takeovers') with ordinality r(value,ordinality)
   left join supplylink_private.fulfilment_phases p on p.handoff_id=(r.value->>'id')::uuid;
  result:=jsonb_set(result,'{takeovers}',rows);
 end if;
 return result;
end; $$;
revoke all on function supplylink_private.stock_planning_workspace(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.stock_planning_workspace(text,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
