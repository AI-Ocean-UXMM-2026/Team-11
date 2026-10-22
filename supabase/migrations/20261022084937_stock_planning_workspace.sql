-- Stock Planning workspace: settings do not move physical stock between pools.
begin;
alter table supplylink_private.reserve_targets
  add column alert_threshold integer,
  add column stock_unit text not null default 'pairs',
  add column plan_source text not null default 'manual',
  add constraint backup_alert_target check(alert_threshold is null or alert_threshold between 0 and target),
  add constraint backup_stock_unit check(length(trim(stock_unit)) between 1 and 24),
  add constraint backup_plan_source check(plan_source in ('manual','ai'));

create table supplylink_private.takeover_details (
  handoff_id uuid primary key references public.delivery_handoffs(id),
  deadline timestamptz not null,
  lines jsonb not null
);
alter table supplylink_private.takeover_details enable row level security;
revoke all on supplylink_private.takeover_details from public,anon,authenticated;

create function supplylink_private.backup_recommendation(p_branch uuid,p_product uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare period_end date:=date_trunc('month',now() at time zone 'Asia/Yangon')::date;
  period_start date; observed timestamptz; months integer; orders integer; units integer;
  mean_units numeric; variation numeric; lead_days numeric; receipts integer; eligible boolean;
begin
  period_start:=(period_end-interval '3 months')::date;
  select greatest(c.observed_since,b.created_at,p.created_at,
    coalesce((select min(observed_at) from supplylink_private.stock_observations where branch_id=b.id and product_id=p.id),now()))
    into observed from supplylink_private.planning_config c cross join public.branches b cross join public.products p
    where b.id=p_branch and p.id=p_product;
  select count(*)::integer into months from generate_series(period_start::timestamp,period_end::timestamp-interval '1 month',interval '1 month') m
    where m at time zone 'Asia/Yangon'>=observed;
  with canonical as (
    select distinct on(h.order_id) h.order_id,h.branch_id,h.created_at from public.delivery_handoffs h
    join public.orders o on o.id=h.order_id and o.status<>'Cancelled'
    where h.status='accepted' order by h.order_id,h.responded_at desc nulls last,h.created_at desc,h.id
  ), demand as (
    select h.order_id,h.created_at,l.quantity from canonical h join public.order_lines l on l.order_id=h.order_id
    where h.branch_id=p_branch and l.product_id=p_product
      and h.created_at>=period_start::timestamp at time zone 'Asia/Yangon'
      and h.created_at<period_end::timestamp at time zone 'Asia/Yangon'
  ), monthly as (
    select m,coalesce(sum(d.quantity),0)::numeric quantity from generate_series(period_start::timestamp,period_end::timestamp-interval '1 month',interval '1 month') m
    left join demand d on date_trunc('month',d.created_at at time zone 'Asia/Yangon')=m group by m
  ) select (select count(distinct order_id)::integer from demand),(select coalesce(sum(quantity),0)::integer from demand),
      avg(quantity),stddev_pop(quantity) into orders,units,mean_units,variation from monthly;
  select count(*)::integer,round(avg(extract(epoch from(received_at-dispatched_at)))/86400,2) into receipts,lead_days
    from public.stock_transfers where destination_branch_id=p_branch and product_id=p_product and purpose='backup'
      and status='received' and received_at>=dispatched_at
      and received_at>=period_start::timestamp at time zone 'Asia/Yangon' and received_at<period_end::timestamp at time zone 'Asia/Yangon';
  eligible:=months>=3 and orders>=5 and receipts>=1;
  return jsonb_build_object('eligible',eligible,'quantity',case when eligible then ceil(mean_units+variation+units::numeric/90*lead_days)::integer else null end,
    'from',period_start,'to',period_end,'completeMonths',months,'orders',orders,'units',units,
    'monthlyAverage',round(mean_units,2),'monthlyVariation',round(variation,2),'leadDays',lead_days,'receipts',receipts,
    'minimumMonths',3,'minimumOrders',5,'minimumReceipts',1);
end; $$;
revoke all on function supplylink_private.backup_recommendation(uuid,uuid) from public,anon,authenticated;

-- The older monthly editor must obey the same evidence gate as the new drawer.
alter function supplylink_private.planning_rows(uuid,date,integer,integer,integer) rename to planning_rows_pre_workspace;
revoke all on function supplylink_private.planning_rows_pre_workspace(uuid,date,integer,integer,integer) from public,anon,authenticated;
create function supplylink_private.planning_rows(p_branch uuid,p_month date,p_buffer integer,p_min_months integer,p_min_orders integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r.value||jsonb_build_object('baseline',case when (rec.value->>'eligible')::boolean
    then ceil((rec.value->>'quantity')::numeric*(100+p_buffer)/100)::integer else null end) order by r.ordinality),'[]'::jsonb)
  from jsonb_array_elements(supplylink_private.planning_rows_pre_workspace(p_branch,p_month,p_buffer,p_min_months,p_min_orders)) with ordinality r(value,ordinality)
  cross join lateral(select supplylink_private.backup_recommendation(p_branch,(r.value->>'productId')::uuid) value) rec;
$$;
revoke all on function supplylink_private.planning_rows(uuid,date,integer,integer,integer) from public,anon,authenticated;

create function supplylink_private.planning_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('branchId',b.id,'branchName',b.name,'productId',p.id,'productName',p.name,'variant',p.pack,
   'unit',coalesce(rt.stock_unit,'pairs'),'retail',greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)),
   'available',coalesce(i.protected_reserve,0),'reserved',coalesce(a.quantity,0),'target',rt.target,
   'threshold',coalesce(rt.alert_threshold,rt.target),'source',coalesce(rt.plan_source,'manual'),
   'low',rt.target is not null and case when rt.alert_threshold is null then coalesce(i.protected_reserve,0)<rt.target else coalesce(i.protected_reserve,0)<=rt.alert_threshold end,
   'incoming',coalesce(n.quantity,0),'openRefills',coalesce(n.open_count,0),
   'proposedRefill',case when rt.target is null then null else greatest(0,rt.target-coalesce(i.protected_reserve,0)-coalesce(n.quantity,0)) end,
   'recommendation',supplylink_private.backup_recommendation(b.id,p.id)) order by b.name,p.pack),'[]'::jsonb)
 from public.branches b cross join public.products p
 left join public.inventory i on i.branch_id=b.id and i.product_id=p.id
 left join supplylink_private.reserve_targets rt on rt.branch_id=b.id and rt.product_id=p.id
 left join lateral(select sum(quantity)::integer quantity from supplylink_private.branch_backup_allocations where branch_id=b.id and product_id=p.id) a on true
 left join lateral(select count(*)::integer open_count,coalesce(sum(t.quantity) filter(where t.status='shipping' and pa.due>=(now() at time zone 'Asia/Yangon')::date),0)::integer quantity
   from public.stock_transfers t left join supplylink_private.planning_arrivals pa on pa.transfer_id=t.id
   where t.destination_branch_id=b.id and t.product_id=p.id and t.purpose='backup' and t.status in ('reserved','shipping')) n on true
 where b.active and p.active and p.brand='STT';
$$;
revoke all on function supplylink_private.planning_catalog() from public,anon,authenticated;

-- Configured backup thresholds use the inclusive boundary. Legacy settings keep their former boundary until edited.
create or replace function supplylink_private.sync_pool_refill_requests(p_branch uuid,p_product uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.inventory; settings supplylink_private.reserve_targets; pool_name text; balance integer; boundary integer; low boolean;
begin
  if p_branch is null then return; end if;
  select * into inv from public.inventory where branch_id=p_branch and product_id=p_product;
  select * into settings from supplylink_private.reserve_targets where branch_id=p_branch and product_id=p_product;
  foreach pool_name in array array['on_hand','backup'] loop
    balance:=case when pool_name='backup' then coalesce(inv.protected_reserve,0) else coalesce(inv.on_hand,0) end;
    boundary:=case when pool_name='backup' then coalesce(settings.alert_threshold,settings.target,0) else 10 end;
    low:=case when pool_name='backup' and settings.alert_threshold is not null then balance<=boundary else balance<boundary end;
    if low and exists(select 1 from public.branches where id=p_branch and active)
      and exists(select 1 from public.products where id=p_product and active and brand='STT') then
      insert into supplylink_private.branch_refill_requests(branch_id,product_id,pool,on_hand,threshold) values(p_branch,p_product,pool_name,balance,boundary)
      on conflict(branch_id,product_id,pool) where resolved_at is null do update set on_hand=excluded.on_hand,threshold=excluded.threshold,updated_at=now();
    else
      update supplylink_private.branch_refill_requests set on_hand=balance,threshold=boundary,resolved_at=now(),updated_at=now()
      where branch_id=p_branch and product_id=p_product and pool=pool_name and resolved_at is null;
    end if;
  end loop;
end; $$;

create function supplylink_private.stock_planning_workspace(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); cached public.workflow_operations; fingerprint text;
  v_branch uuid; v_product uuid; row_data jsonb; result jsonb; rec jsonb; qty integer; boundary integer; unit_name text; source_name text;
  reason text:=trim(coalesce(p_payload->>'reason','')); tr public.stock_transfers; v_order public.orders; v_deadline timestamptz; v_handoff uuid;
begin
  if actor.role<>'hq' then raise exception 'Stock planning is restricted to HQ.' using errcode='42501'; end if;
  if p_action not in ('overview','detail','settings','refill','takeover','cancel_takeover','dispatch_refill') then
    return supplylink_private.stock_planning_with_pools(p_action,p_payload,p_key);
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>24000 then raise exception 'Invalid planning request.'; end if;
  if p_action='overview' then return jsonb_build_object('rows',supplylink_private.planning_catalog()); end if;
  v_branch:=(p_payload->>'branchId')::uuid; v_product:=(p_payload->>'productId')::uuid;
  if p_action='detail' then
    select r into row_data from jsonb_array_elements(supplylink_private.planning_catalog()) r where r->>'branchId'=v_branch::text and r->>'productId'=v_product::text;
    if row_data is null then raise exception 'Choose an active branch and SKU.'; end if;
    return jsonb_build_object('row',row_data,
      'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'quantity',t.quantity,'status',t.status,
        'createdAt',t.created_at,'receivedAt',t.received_at,'due',a.due) order by t.created_at desc) from
        (select * from public.stock_transfers where destination_branch_id=v_branch and product_id=v_product and purpose='backup' order by created_at desc limit 30) t
        left join supplylink_private.planning_arrivals a on a.transfer_id=t.id),'[]'::jsonb),
      'takeovers',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'orderId',o.id,'reference',o.reference,'quantity',l.quantity,
        'unit',coalesce((select x->>'unit' from jsonb_array_elements(d.lines) x where x->>'productId'=v_product::text),row_data->>'unit'),
        'reason',h.reason,'resolution',h.original_resolution,'responseReason',h.response_reason,'deadline',d.deadline,'fulfilledAt',o.sme_received_at,
        'status',case when o.status='Cancelled' then 'cancelled' when h.status<>'accepted' then h.status
          when o.source_branch_id is distinct from v_branch then 'replaced' when o.sme_received_at is not null then 'fulfilled'
          when o.dispatched_at is not null then 'in transit' else 'reserved' end,
        'actor',p.name,'at',h.created_at,'events',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'at',e.created_at,'actor',ep.name) order by e.created_at)
          from public.order_events e join public.profiles ep on ep.id=e.actor_id where e.order_id=o.id),'[]'::jsonb)) order by h.created_at desc)
        from (select * from public.delivery_handoffs where branch_id=v_branch order by created_at desc limit 50) h
        join public.orders o on o.id=h.order_id join public.order_lines l on l.order_id=o.id and l.product_id=v_product
        join public.profiles p on p.id=h.created_by left join supplylink_private.takeover_details d on d.handoff_id=h.id),'[]'::jsonb),
      'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'quantity',l.quantity,'dispatched',o.dispatched_at is not null,
        'lines',(select jsonb_agg(jsonb_build_object('variant',ol.pack_snapshot,'quantity',ol.quantity)) from public.order_lines ol where ol.order_id=o.id)))
        from (select * from public.orders where status in ('Confirmed','Preparing','On hold') and payment_verified_at is not null and reserved_at is not null
          and not handoff_pending and sme_received_at is null and hq_completed_at is null and source_branch_id is null order by created_at desc limit 100) o
        join public.order_lines l on l.order_id=o.id and l.product_id=v_product),'[]'::jsonb));
  end if;
  if p_key is null then raise exception 'A retry key is required.'; end if;
  fingerprint:=md5('planning.workspace.'||p_action||p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;
  -- Lock the branch before inspecting open refills/settings; concurrent planning creates one transfer.
  perform id from public.branches where id=v_branch and active for update;
  if not found or not exists(select 1 from public.products where id=v_product and active and brand='STT') then raise exception 'Choose an active branch and SKU.'; end if;
  if length(reason) not between 3 and 500 then raise exception 'Record a reason of 3 to 500 characters.'; end if;
  if p_action='settings' then
    qty:=(p_payload->>'target')::integer; boundary:=(p_payload->>'threshold')::integer; unit_name:=trim(p_payload->>'unit'); source_name:=coalesce(p_payload->>'source','manual');
    if qty is null or qty not between 0 and 1000000 or boundary is null or boundary not between 0 and qty
      or unit_name is null or unit_name !~ '^[a-zA-Z][a-zA-Z ]{0,23}$' or source_name not in ('manual','ai') then raise exception 'Use whole quantities, a valid unit, and an alert threshold no greater than the target.'; end if;
    if source_name='ai' then
      rec:=supplylink_private.backup_recommendation(v_branch,v_product);
      if not (rec->>'eligible')::boolean or qty is distinct from (rec->>'quantity')::integer then raise exception 'Insufficient or changed evidence. Refresh and continue with the HQ manual plan.'; end if;
    end if;
    insert into supplylink_private.reserve_targets(branch_id,product_id,target,alert_threshold,stock_unit,plan_source,plan_id)
      values(v_branch,v_product,qty,boundary,unit_name,source_name,null)
      on conflict(branch_id,product_id) do update set target=excluded.target,alert_threshold=excluded.alert_threshold,stock_unit=excluded.stock_unit,plan_source=excluded.plan_source,plan_id=null;
    result:=jsonb_build_object('message','Backup settings saved. Stock balances are unchanged.');
  elsif p_action='refill' then
    select * into tr from public.stock_transfers where destination_branch_id=v_branch and product_id=v_product and purpose='backup' and status in ('reserved','shipping') order by created_at limit 1;
    if found then result:=jsonb_build_object('message','An open backup refill already exists. Review it before creating another.','transferId',tr.id);
    else
      select r into row_data from jsonb_array_elements(supplylink_private.planning_catalog()) r where r->>'branchId'=v_branch::text and r->>'productId'=v_product::text;
      qty:=(row_data->>'proposedRefill')::integer;
      if qty is null or qty<=0 then raise exception 'Set a target above available stock and confirmed incoming before creating a refill.'; end if;
      result:=supplylink_private.workflow_with_stock_pools('transfer_create',jsonb_build_object('destinationBranchId',v_branch,'sourceBranchId','','productId',v_product,'quantity',qty,'purpose','backup','reason',reason),gen_random_uuid());
    end if;
  elsif p_action='takeover' then
    v_deadline:=(p_payload->>'deadline')::timestamptz;
    if v_deadline is null then raise exception 'Record the original wholesale order deadline.'; end if;
    select * into v_order from public.orders where id=(p_payload->>'orderId')::uuid for update;
    if v_order.source_branch_id is not null or not exists(select 1 from public.order_lines where order_id=v_order.id and product_id=v_product) then raise exception 'Choose the original HQ wholesale order containing this SKU.'; end if;
    result:=supplylink_private.workflow_with_stock_pools('route_branch',p_payload||jsonb_build_object('branchId',v_branch),gen_random_uuid());
    select id into v_handoff from public.delivery_handoffs where order_id=v_order.id and status='pending';
    insert into supplylink_private.takeover_details(handoff_id,deadline,lines)
      select v_handoff,v_deadline,jsonb_agg(jsonb_build_object('productId',l.product_id,'quantity',l.quantity,'unit',coalesce(rt.stock_unit,'pairs')))
      from public.order_lines l left join supplylink_private.reserve_targets rt on rt.branch_id=v_branch and rt.product_id=l.product_id where l.order_id=v_order.id;
  elsif p_action='cancel_takeover' then
    if not exists(select 1 from public.delivery_handoffs where id=(p_payload->>'handoffId')::uuid and order_id=(p_payload->>'orderId')::uuid and branch_id=v_branch) then raise exception 'Takeover not found for this branch.'; end if;
    result:=supplylink_private.workflow_with_stock_pools('handoff_cancel',p_payload,gen_random_uuid());
  elsif p_action='dispatch_refill' then
    if not exists(select 1 from public.stock_transfers where id=(p_payload->>'transferId')::uuid and destination_branch_id=v_branch and product_id=v_product and purpose='backup' and source_branch_id is null) then raise exception 'Backup refill not found.'; end if;
    result:=supplylink_private.workflow_with_stock_pools('transfer_dispatch',p_payload,gen_random_uuid());
  end if;
  insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'planning.'||p_action,v_branch,p_payload||jsonb_build_object('evidence',rec));
  insert into public.workflow_operations(actor_id,operation_key,fingerprint,result) values(actor.id,p_key,fingerprint,result);
  return result;
end; $$;
revoke all on function supplylink_private.stock_planning_workspace(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.stock_planning_workspace(text,jsonb,uuid) to authenticated;
create or replace function public.stock_planning(p_action text,p_payload jsonb,p_key uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select supplylink_private.stock_planning_workspace(p_action,p_payload,p_key); $$;
revoke all on function public.stock_planning(text,jsonb,uuid) from public,anon;
grant execute on function public.stock_planning(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
