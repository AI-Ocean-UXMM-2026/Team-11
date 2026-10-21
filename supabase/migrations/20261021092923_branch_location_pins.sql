-- Branch locations use the same map-pin model as HQ-issued accounts.
-- Existing addresses remain available until HQ saves a pin for that branch.
begin;
alter table public.branches add column latitude double precision, add column longitude double precision;
alter table public.branches add constraint branches_location_pin check (
  (latitude is null) = (longitude is null) and
  (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
);

create or replace function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles; o public.orders; b public.branches; d public.profiles;
  attempt public.delivery_attempts; hand public.delivery_handoffs; transfer public.stock_transfers; inv public.inventory;
  cached public.workflow_operations; response jsonb; fingerprint text; row_line record;
  v_reason text:=trim(coalesce(p_payload->>'reason','')); target uuid; selected_branch uuid; source_branch uuid; destination_branch uuid;
  new_id uuid; quantity integer; resolution text; movement_kind text;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and not must_change_password;
  if actor.id is null then raise exception 'An active account with completed setup is required.'; end if;
  if actor.branch_id is not null then
    perform 1 from public.branches where id=actor.branch_id and active for share;
    if not found then raise exception 'This branch is closed.'; end if;
  end if;
  if p_key is null or p_action is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Operation, payload and retry key are required.'; end if;
  fingerprint:=md5(p_action||p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;

  if p_action in ('branch_create','branch_update','branch_close') then
    if actor.role<>'hq' then raise exception 'Only HQ can manage branches.'; end if;
    if p_action in ('branch_create','branch_update') then
      if length(trim(coalesce(p_payload->>'name',''))) not between 2 and 100 then raise exception 'Enter a branch name of 2–100 characters.'; end if;
      if p_action='branch_create' or p_payload ? 'pin' then
        if jsonb_typeof(p_payload->'pin') is distinct from 'object'
          or jsonb_typeof(p_payload#>'{pin,latitude}') is distinct from 'number'
          or jsonb_typeof(p_payload#>'{pin,longitude}') is distinct from 'number'
          or not ((p_payload#>>'{pin,latitude}')::numeric between -90 and 90)
          or not ((p_payload#>>'{pin,longitude}')::numeric between -180 and 180)
        then raise exception 'Choose a valid branch location pin.'; end if;
      end if;
    end if;
    if p_action='branch_create' then
      insert into public.branches(name,address,manager_name,latitude,longitude) values(trim(p_payload->>'name'),'',left(trim(coalesce(p_payload->>'manager','')),100),(p_payload#>>'{pin,latitude}')::double precision,(p_payload#>>'{pin,longitude}')::double precision) returning id into new_id;
      insert into public.inventory(branch_id,product_id) select new_id,id from public.products where brand='STT' and active;
      response:=jsonb_build_object('message','Branch created with zero stock. Issue its login from Accounts.','branchId',new_id);
    else
      target:=(p_payload->>'branchId')::uuid;
      select * into b from public.branches where id=target and active for update;
      if not found then raise exception 'Open branch not found.'; end if;
      if p_action='branch_update' then
        if not (p_payload ? 'pin') and b.latitude is null and length(trim(coalesce(p_payload->>'address',''))) not between 5 and 300 then raise exception 'Choose a valid branch location pin.'; end if;
        update public.branches set name=trim(p_payload->>'name'),
          address=case when p_payload ? 'pin' or b.latitude is not null then '' else trim(p_payload->>'address') end,
          latitude=case when p_payload ? 'pin' then (p_payload#>>'{pin,latitude}')::double precision else b.latitude end,
          longitude=case when p_payload ? 'pin' then (p_payload#>>'{pin,longitude}')::double precision else b.longitude end,
          manager_name=left(trim(coalesce(p_payload->>'manager','')),100) where id=b.id;
        response:=jsonb_build_object('message','Branch details updated.');
      else
        if length(v_reason)<3 then raise exception 'Record why this branch is closing.'; end if;
        if exists(select 1 from public.inventory where branch_id=b.id and (on_hand>0 or allocated>0)) then raise exception 'Return remaining branch stock to HQ before closure.'; end if;
        if exists(select 1 from public.orders where source_branch_id=b.id and status not in ('Done','Cancelled')) or exists(select 1 from public.delivery_handoffs where branch_id=b.id and status='pending') then raise exception 'Resolve branch deliveries and handoffs before closure.'; end if;
        if exists(select 1 from public.stock_transfers where (source_branch_id=b.id or destination_branch_id=b.id) and status in ('reserved','shipping')) then raise exception 'Complete or cancel outstanding stock transfers before closure.'; end if;
        update public.branches set active=false,closed_at=now() where id=b.id;
        update public.profiles set status='suspended' where branch_id=b.id and role in ('branch','driver');
        response:=jsonb_build_object('message','Branch closed. Its staff and drivers are suspended; history is preserved.');
      end if;
    end if;
  elsif p_action='driver_affiliation' then
    if actor.role<>'hq' or length(v_reason)<3 then raise exception 'HQ access and an affiliation-change reason are required.'; end if;
    selected_branch:=nullif(p_payload->>'branchId','')::uuid;
    if selected_branch is not null then perform 1 from public.branches where id=selected_branch and active for share; if not found then raise exception 'Choose an open branch.'; end if; end if;
    select * into d from public.profiles where id=(p_payload->>'driverId')::uuid and role='driver' for update;
    if not found then raise exception 'Driver not found.'; end if;
    if exists(select 1 from public.delivery_attempts where driver_id=d.id and active) then raise exception 'Resolve active driver assignments before changing affiliation.'; end if;
    update public.profiles set branch_id=selected_branch where id=d.id;
    target:=d.id; response:=jsonb_build_object('message','Driver affiliation updated.');
  elsif p_action='transfer_create' then
    if actor.role<>'hq' or length(v_reason)<3 then raise exception 'Only HQ can authorize a stock transfer, with a reason.'; end if;
    source_branch:=nullif(p_payload->>'sourceBranchId','')::uuid; destination_branch:=nullif(p_payload->>'destinationBranchId','')::uuid;
    if source_branch is not distinct from destination_branch or (source_branch is not null and destination_branch is not null) then raise exception 'Choose HQ and one branch as the transfer endpoints.'; end if;
    selected_branch:=coalesce(source_branch,destination_branch);
    perform 1 from public.branches where id=selected_branch and active for share;
    if not found then raise exception 'Choose an open branch.'; end if;
    quantity:=(p_payload->>'quantity')::integer;
    if quantity is null or quantity not between 1 and 1000000 then raise exception 'Enter whole pairs to transfer.'; end if;
    if not exists(select 1 from public.products where id=(p_payload->>'productId')::uuid and brand='STT' and active) then raise exception 'Choose an active STT variant.'; end if;
    select * into inv from public.inventory where product_id=(p_payload->>'productId')::uuid and branch_id is not distinct from source_branch for update;
    if not found or inv.on_hand-inv.allocated-(case when source_branch is null then inv.protected_reserve else 0 end)<quantity then raise exception 'Not enough unallocated stock at the source.'; end if;
    update public.inventory set protected_reserve=case when source_branch is null then protected_reserve else greatest(0,protected_reserve-greatest(0,quantity-(on_hand-allocated-protected_reserve))) end,allocated=allocated+quantity where id=inv.id;
    new_id:=gen_random_uuid();
    insert into public.stock_transfers(id,reference,source_branch_id,destination_branch_id,product_id,quantity,reason,created_by) values(new_id,'TR-'||upper(substr(new_id::text,1,8)),source_branch,destination_branch,inv.product_id,quantity,v_reason,actor.id);
    response:=jsonb_build_object('message','Transfer reserved. The source must confirm dispatch before receipt.','transferId',new_id);
  elsif p_action in ('transfer_dispatch','transfer_receive','transfer_cancel') then
    target:=(p_payload->>'transferId')::uuid;
    select * into transfer from public.stock_transfers where id=target for update;
    if not found then raise exception 'Transfer not found.'; end if;
    if p_action='transfer_dispatch' then
      if transfer.status<>'reserved' or not ((actor.role='hq' and transfer.source_branch_id is null) or (actor.role='branch' and actor.branch_id is not distinct from transfer.source_branch_id)) or not coalesce((p_payload->>'confirmed')::boolean,false) then raise exception 'The source location must confirm actual dispatch.'; end if;
      update public.inventory set on_hand=on_hand-transfer.quantity,allocated=allocated-transfer.quantity where product_id=transfer.product_id and branch_id is not distinct from transfer.source_branch_id and allocated>=transfer.quantity;
      if not found then raise exception 'Reserved transfer stock is unavailable.'; end if;
      update public.stock_transfers set status='shipping',dispatched_at=now(),dispatched_by=actor.id where id=transfer.id;
      insert into public.inventory_movements(product_id,branch_id,actor_id,kind,quantity,reason) values(transfer.product_id,transfer.source_branch_id,actor.id,'transfer_out',-transfer.quantity,transfer.reference||': '||transfer.reason);
      response:=jsonb_build_object('message','Transfer dispatched. Destination stock waits for receipt.');
    elsif p_action='transfer_receive' then
      if transfer.status<>'shipping' or not ((actor.role='hq' and transfer.destination_branch_id is null) or (actor.role='branch' and actor.branch_id is not distinct from transfer.destination_branch_id)) or not coalesce((p_payload->>'confirmed')::boolean,false) then raise exception 'The destination must confirm full physical receipt.'; end if;
      insert into public.inventory(branch_id,product_id,on_hand) values(transfer.destination_branch_id,transfer.product_id,transfer.quantity) on conflict(branch_id,product_id) do update set on_hand=public.inventory.on_hand+excluded.on_hand;
      update public.stock_transfers set status='received',received_at=now(),received_by=actor.id where id=transfer.id;
      insert into public.inventory_movements(product_id,branch_id,actor_id,kind,quantity,reason) values(transfer.product_id,transfer.destination_branch_id,actor.id,'transfer_in',transfer.quantity,transfer.reference||': Physical receipt');
      response:=jsonb_build_object('message','Receipt recorded and destination stock replenished.');
    else
      if actor.role<>'hq' or transfer.status<>'reserved' or length(v_reason)<3 then raise exception 'HQ can cancel a reserved transfer with a reason, before dispatch.'; end if;
      update public.inventory set allocated=allocated-transfer.quantity where product_id=transfer.product_id and branch_id is not distinct from transfer.source_branch_id;
      update public.stock_transfers set status='cancelled' where id=transfer.id;
      response:=jsonb_build_object('message','Transfer cancelled and allocation released.');
    end if;
  else
    if p_payload ? 'orderId' then
      target:=(p_payload->>'orderId')::uuid;
      select * into o from public.orders where id=target for update;
      if not found then raise exception 'Order not found.'; end if;
    end if;
    if p_action='route_branch' then
      if actor.role<>'hq' or length(v_reason)<3 or o.id is null or o.status not in ('Confirmed','Preparing','On hold') or o.payment_verified_at is null or o.reserved_at is null or o.handoff_pending or o.sme_received_at is not null or o.hq_completed_at is not null then raise exception 'HQ can route a paid, reserved order before dispatch, or after placing its delivery on hold.'; end if;
      selected_branch:=(p_payload->>'branchId')::uuid;
      select * into b from public.branches where id=selected_branch and active for share;
      if not found or b.id is not distinct from o.source_branch_id then raise exception 'Choose a different open branch for backup.'; end if;
      select * into attempt from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1 for update;
      resolution:='Not dispatched; old allocation releases when the branch accepts';
      if o.dispatched_at is not null then
        if attempt.id is null or attempt.status='handed_over' then raise exception 'Reconcile any handed-over goods through the return process before replacement.'; end if;
        if not attempt.original_consignment_resolved then
          resolution:=p_payload->>'originalResolution';
          if resolution not in ('returned_to_hq','lost') or resolution is null or not coalesce((p_payload->>'consignmentResolved')::boolean,false) then raise exception 'Confirm how the original consignment was resolved before branch backup.'; end if;
          if resolution='returned_to_hq' then
            if not coalesce((p_payload->>'receivedBack')::boolean,false) then raise exception 'Confirm all original pairs were physically received back at HQ.'; end if;
            perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and i.branch_id is null order by i.product_id for update of i;
            for row_line in select * from public.order_lines where order_id=o.id loop
              update public.inventory set on_hand=on_hand+row_line.quantity where product_id=row_line.product_id and branch_id is null;
              insert into public.inventory_movements(product_id,order_id,actor_id,kind,quantity,reason) values(row_line.product_id,o.id,actor.id,'return_original:'||attempt.id::text,row_line.quantity,v_reason);
            end loop;
          end if;
          update public.delivery_attempts set active=false,status='replaced',original_consignment_resolved=true where id=attempt.id;
        else resolution:='Original consignment already reconciled'; end if;
      end if;
      new_id:=gen_random_uuid();
      insert into public.delivery_handoffs(id,order_id,branch_id,previous_attempt_id,original_resolution,reason,created_by) values(new_id,o.id,b.id,attempt.id,resolution,v_reason,actor.id);
      update public.orders set handoff_pending=true,replacement_required=(dispatched_at is not null),resume_status=case when status<>'On hold' then status else resume_status end,status='On hold',has_open_issue=true,issue_reason='Branch handoff: '||v_reason where id=o.id;
      response:=jsonb_build_object('message','Backup requested. The branch must accept and reserve its own stock.');
    elsif p_action in ('handoff_accept','handoff_decline','handoff_cancel') then
      select * into hand from public.delivery_handoffs where id=(p_payload->>'handoffId')::uuid and order_id=o.id and status='pending' for update;
      if not found or not o.handoff_pending or o.status<>'On hold' then raise exception 'Pending branch handoff not found.'; end if;
      if p_action='handoff_cancel' then
        if actor.role<>'hq' or length(v_reason)<3 then raise exception 'HQ must record why the handoff was cancelled.'; end if;
        update public.delivery_handoffs set status='cancelled',response_reason=v_reason,responded_by=actor.id,responded_at=now() where id=hand.id;
        update public.orders set handoff_pending=false where id=o.id;
        response:=jsonb_build_object('message','Request cancelled. Resolve the hold or select another branch.');
      else
        if actor.role<>'branch' or actor.branch_id is distinct from hand.branch_id then raise exception 'Only the selected branch can respond to this handoff.'; end if;
        if p_action='handoff_decline' then
          if length(v_reason)<3 then raise exception 'Explain why the branch cannot accept.'; end if;
          update public.delivery_handoffs set status='declined',response_reason=v_reason,responded_by=actor.id,responded_at=now() where id=hand.id;
          update public.orders set handoff_pending=false where id=o.id;
          response:=jsonb_build_object('message','Handoff declined. HQ must arrange the next step.');
        else
          perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and (i.branch_id=hand.branch_id or i.branch_id is not distinct from o.source_branch_id) order by i.branch_id nulls first,i.product_id for update of i;
          if exists(select 1 from public.order_lines l left join public.inventory i on i.product_id=l.product_id and i.branch_id=hand.branch_id where l.order_id=o.id and (i.id is null or i.on_hand-i.allocated<l.quantity)) then raise exception 'The branch cannot reserve the full order. Refill stock or decline the request.'; end if;
          if o.dispatched_at is null then update public.inventory i set allocated=i.allocated-l.quantity from public.order_lines l where l.order_id=o.id and i.product_id=l.product_id and i.branch_id is not distinct from o.source_branch_id; end if;
          update public.inventory i set allocated=i.allocated+l.quantity,protected_reserve=greatest(0,i.protected_reserve-l.quantity) from public.order_lines l where l.order_id=o.id and i.product_id=l.product_id and i.branch_id=hand.branch_id;
          update public.delivery_attempts set active=false,status='replaced',original_consignment_resolved=true where order_id=o.id and active;
          update public.delivery_handoffs set status='accepted',responded_by=actor.id,responded_at=now() where id=hand.id;
          select * into b from public.branches where id=hand.branch_id;
          update public.orders set source_branch_id=b.id,source_name=b.name,status='Confirmed',handoff_pending=false,replacement_required=false,has_open_issue=false,issue_reason=null,resume_status=null,reserved_at=now(),dispatched_at=null where id=o.id;
          response:=jsonb_build_object('message','Branch accepted and reserved all pairs. Assign a branch driver next.');
        end if;
      end if;
    elsif p_action='assign' then
      if o.id is null or o.status not in ('Confirmed','Preparing') or not (actor.role='hq' or (actor.role='branch' and actor.branch_id is not distinct from o.source_branch_id)) then raise exception 'Only HQ or the fulfilling branch can assign this delivery.'; end if;
      select * into d from public.profiles where id=(p_payload->>'driverId')::uuid and role='driver' and status='active' and not must_change_password for share;
      if not found or d.branch_id is distinct from o.source_branch_id then raise exception 'Choose an active driver assigned to the fulfilment location.'; end if;
      update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active and status='planned';
      insert into public.delivery_attempts(order_id,driver_id,source_branch_id) values(o.id,d.id,o.source_branch_id);
      response:=jsonb_build_object('message','Location driver assigned.');
    elsif p_action='dispatch' then
      select * into attempt from public.delivery_attempts where order_id=o.id and active for update;
      if o.id is null or o.status<>'Preparing' or o.has_open_issue or o.dispatched_at is not null or attempt.id is null or not (actor.role='hq' or (actor.role='branch' and actor.branch_id is not distinct from o.source_branch_id)) then raise exception 'Prepare the order and assign a location driver before dispatch.'; end if;
      if not exists(select 1 from public.profiles where id=attempt.driver_id and role='driver' and status='active' and not must_change_password and branch_id is not distinct from o.source_branch_id) then raise exception 'The assigned location driver is no longer active.'; end if;
      perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and i.branch_id is not distinct from o.source_branch_id order by i.product_id for update of i;
      movement_kind:=case when exists(select 1 from public.inventory_movements where order_id=o.id and kind='dispatch') then 'dispatch:'||attempt.id::text else 'dispatch' end;
      for row_line in select * from public.order_lines where order_id=o.id loop
        update public.inventory set on_hand=on_hand-row_line.quantity,allocated=allocated-row_line.quantity where product_id=row_line.product_id and branch_id is not distinct from o.source_branch_id and allocated>=row_line.quantity;
        if not found then raise exception 'Reserved stock could not be dispatched.'; end if;
        insert into public.inventory_movements(product_id,branch_id,order_id,actor_id,kind,quantity,reason) values(row_line.product_id,o.source_branch_id,o.id,actor.id,movement_kind,-row_line.quantity,'Wholesale dispatch');
      end loop;
      update public.delivery_attempts set status='dispatched',dispatched_at=now() where id=attempt.id;
      update public.orders set status='Shipping',dispatched_at=now() where id=o.id;
      response:=jsonb_build_object('message','Delivery dispatched from its fulfilment location.');
    elsif actor.role='branch' and p_action in ('prepare','hold') then
      if o.id is null or actor.branch_id is distinct from o.source_branch_id then raise exception 'This delivery belongs to another location.'; end if;
      if p_action='prepare' then
        if o.status<>'Confirmed' or o.payment_verified_at is null or o.reserved_at is null then raise exception 'Only confirmed, reserved orders can be prepared.'; end if;
        update public.orders set status='Preparing' where id=o.id;
        response:=jsonb_build_object('message','Branch preparation started.');
      else
        if o.status not in ('Preparing','Shipping','Complete') or length(v_reason)<3 then raise exception 'Record an issue on an active branch delivery.'; end if;
        update public.orders set resume_status=status,status='On hold',has_open_issue=true,issue_reason=v_reason where id=o.id;
        response:=jsonb_build_object('message','Branch issue recorded for HQ resolution.');
      end if;
    elsif p_action='cancel' and o.source_branch_id is not null then
      if actor.role<>'hq' or o.status not in ('Confirmed','Preparing') or length(v_reason)<3 or o.dispatched_at is not null then raise exception 'HQ must coordinate branch cancellation before dispatch.'; end if;
      perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and i.branch_id=o.source_branch_id order by i.product_id for update of i;
      update public.inventory i set allocated=i.allocated-l.quantity from public.order_lines l where l.order_id=o.id and i.product_id=l.product_id and i.branch_id=o.source_branch_id;
      update public.orders set status='Cancelled',refund_required=true where id=o.id;
      update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active;
      response:=jsonb_build_object('message','Branch allocation released. HQ must follow up the payment refund.');
    else
      if o.id is not null and (o.handoff_pending or o.replacement_required) and p_action in ('resolve','prepare','dispatch','assign','handover','receive','complete','cancel') then raise exception 'Resolve the branch handoff before resuming fulfilment.'; end if;
      return supplylink_private.workflow_execute(p_action,p_payload,p_key);
    end if;
    if o.id is not null then insert into public.order_events(order_id,actor_id,action,reason) values(o.id,actor.id,p_action,v_reason); end if;
  end if;
  insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'workflow.'||p_action,coalesce(target,new_id),jsonb_build_object('reason',v_reason));
  insert into public.workflow_operations values(actor.id,p_key,fingerprint,response);
  return response;
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;


create or replace function public.workflow_snapshot(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor(); response jsonb;
  order_page jsonb; retail_page jsonb; transfer_page jsonb; report_page jsonb;
  selected_order jsonb:=null; stats jsonb;
  empty_page jsonb:=jsonb_build_object('rows','[]'::jsonb,'total',0,'page',1,'pageSize',coalesce((p_query->>'pageSize')::integer,25));
  query jsonb:=p_query-'orderId';
begin
  order_page:=public.workflow_list('orders',query||jsonb_build_object('page',coalesce((query->>'ordersPage')::integer,1)));
  retail_page:=empty_page; transfer_page:=empty_page; report_page:=empty_page;
  if actor.role in ('hq','branch') then
    retail_page:=public.workflow_list('retail',query||jsonb_build_object('page',coalesce((query->>'retailPage')::integer,1)));
    transfer_page:=public.workflow_list('transfers',query||jsonb_build_object('page',coalesce((query->>'transfersPage')::integer,1)));
    report_page:=public.workflow_list('report',query||jsonb_build_object('page',coalesce((query->>'reportPage')::integer,1)));
  end if;
  if nullif(p_query->>'orderId','') is not null then
    selected_order:=(public.workflow_list('orders',jsonb_build_object('orderId',p_query->>'orderId'))->'rows')->0;
  end if;
  select jsonb_build_object('orders',count(*),'active',count(*) filter(where status not in ('Done','Cancelled','Draft')),'awaiting',count(*) filter(where status='Awaiting verification'),'held',count(*) filter(where status='On hold'),'shipping',count(*) filter(where status='Shipping'),'wholesale',case when actor.role in ('hq','sme') then coalesce(sum(merchandise_total) filter(where status='Done'),0) else 0 end)
    into stats from supplylink_private.scoped_orders(actor);
  stats:=stats||jsonb_build_object(
    'retail',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where actor.role='hq' or branch_id=actor.branch_id),0) else 0 end,
    'retailCount',retail_page->'total',
    'pendingTransfers',case when actor.role in ('hq','branch') then (select count(*) from public.stock_transfers where status in ('reserved','shipping') and (actor.role='hq' or source_branch_id=actor.branch_id or destination_branch_id=actor.branch_id)) else 0 end);
  select jsonb_build_object(
    'orders',order_page->'rows',
    'attentionOrders',public.workflow_list('orders',jsonb_build_object('attention',true))->'rows',
    'products',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'pack',p.pack,'price',p.wholesale_price,
      'stock',case when actor.role='sme' then greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) else coalesce(i.on_hand,0) end,
      'reserve',case when actor.role='sme' then 0 else coalesce(i.allocated+i.protected_reserve,0) end,'minimum',p.minimum_packs,'tone',p.tone,'brand',p.brand,'size',p.size,'color',p.color) order by p.color,p.size)
      from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id is not distinct from (case when actor.role='branch' then actor.branch_id else null end) where p.brand='STT' and p.active),'[]'::jsonb) end,
    'branches',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'pin',case when b.latitude is null then null else jsonb_build_object('latitude',b.latitude,'longitude',b.longitude) end,'manager',b.manager_name,'active',b.active,'closedAt',b.closed_at,
      'driverCount',(select count(*) from public.profiles where branch_id=b.id and role='driver' and status='active'),
      'staffCount',(select count(*) from public.profiles where branch_id=b.id and role='branch' and status='active'),
      'inventory',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'variant',p.pack,'onHand',coalesce(i.on_hand,0),'allocated',coalesce(i.allocated,0),'protected',coalesce(i.protected_reserve,0))) from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=b.id where p.brand='STT' and p.active),'[]'::jsonb) else '[]'::jsonb end,'sales',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where branch_id=b.id),0) else 0 end,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',(select count(*) from public.inventory where branch_id=b.id and on_hand-protected_reserve-allocated<10))) from public.branches b where (actor.role='hq' or b.active) and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
    'accounts',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'username',p.username,'phone',case when actor.role='hq' then p.phone else null end,'pin',case when actor.role='hq' and p.latitude is not null then jsonb_build_object('latitude',p.latitude,'longitude',p.longitude) else null end,'role',p.role,'branchId',p.branch_id,'branchName',coalesce(b.name,'STT Yangon HQ'),'status',case when p.status='suspended' then 'Suspended' when p.must_change_password then 'Pending setup' else 'Active' end,'affiliation',case when p.role in ('branch','driver') then coalesce(b.name,'STT Yangon HQ') else p.address end)) from public.profiles p left join public.branches b on b.id=p.branch_id where (actor.role='hq' and p.role in ('sme','driver','branch')) or (actor.role='branch' and p.role='driver' and p.branch_id=actor.branch_id)),'[]'::jsonb) else '[]'::jsonb end,
    'settings',jsonb_build_object('shipping',case when actor.role in ('driver','branch') then null else s.shipping_fee end,'instructions',case when actor.role in ('driver','branch') then '' else s.payment_instructions end,'area',s.delivery_area),
    'retailSales',retail_page->'rows','salesEvents',report_page->'rows','transfers',transfer_page->'rows',
    'selectedOrder',selected_order,'summary',stats,
    'report',coalesce(report_page->'summary','{}'::jsonb)||jsonb_build_object('cutoff',report_page->'cutoff'),
    'pagination',jsonb_build_object('orders',order_page-'rows'-'summary'-'cutoff','retail',retail_page-'rows','transfers',transfer_page-'rows','report',report_page-'rows'-'summary'-'cutoff'),
    'query',query||jsonb_strip_nulls(jsonb_build_object('orderId',p_query->>'orderId','ordersPage',order_page->'page','retailPage',retail_page->'page','transfersPage',transfer_page->'page','reportPage',report_page->'page','pageSize',order_page->'pageSize','reportFrom',coalesce(query->>'reportFrom',to_char(date_trunc('month',now() at time zone 'Asia/Yangon'),'YYYY-MM-DD')),'reportTo',coalesce(query->>'reportTo',to_char(now() at time zone 'Asia/Yangon','YYYY-MM-DD')),'reportCutoff',report_page->>'cutoff')),
    'workflowEnabled',true
  ) into response from public.workflow_settings s where singleton;
  return response;
end; $$;
revoke all on function public.workflow_snapshot(jsonb) from public,anon;
grant execute on function public.workflow_snapshot(jsonb) to authenticated;


commit;
