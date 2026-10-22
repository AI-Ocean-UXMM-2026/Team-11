-- Refresh validated planning routines for existing local databases; preserve all stock and history.
begin;
-- The older monthly editor must obey the same evidence gate as the new drawer.
do $$ begin
  if to_regprocedure('supplylink_private.planning_rows_pre_workspace(uuid,date,integer,integer,integer)') is null then
    alter function supplylink_private.planning_rows(uuid,date,integer,integer,integer) rename to planning_rows_pre_workspace;
  end if;
end; $$;
revoke all on function supplylink_private.planning_rows_pre_workspace(uuid,date,integer,integer,integer) from public,anon,authenticated;
create or replace function supplylink_private.planning_rows(p_branch uuid,p_month date,p_buffer integer,p_min_months integer,p_min_orders integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r.value||jsonb_build_object('baseline',case when (rec.value->>'eligible')::boolean
    then ceil((rec.value->>'quantity')::numeric*(100+p_buffer)/100)::integer else null end) order by r.ordinality),'[]'::jsonb)
  from jsonb_array_elements(supplylink_private.planning_rows_pre_workspace(p_branch,p_month,p_buffer,p_min_months,p_min_orders)) with ordinality r(value,ordinality)
  cross join lateral(select supplylink_private.backup_recommendation(p_branch,(r.value->>'productId')::uuid) value) rec;
$$;
revoke all on function supplylink_private.planning_rows(uuid,date,integer,integer,integer) from public,anon,authenticated;

create or replace function supplylink_private.stock_planning_workspace(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); cached public.workflow_operations; fingerprint text;
  v_branch uuid; v_product uuid; row_data jsonb; result jsonb; rec jsonb; qty integer; boundary integer; unit_name text; source_name text;
  reason text:=trim(coalesce(p_payload->>'reason','')); tr public.stock_transfers; v_order public.orders; v_deadline timestamptz; v_handoff uuid;
begin
  if actor.role<>'hq' then raise exception 'Stock planning is restricted to HQ.' using errcode='42501'; end if;
  if p_action not in ('overview','detail','settings','refill','takeover','cancel_takeover','dispatch_refill') then
    result:=supplylink_private.stock_planning_with_pools(p_action,p_payload,p_key);
    if p_action='approve' then
      update supplylink_private.reserve_targets rt set plan_source=case when (r.value->>'manual')::boolean then 'manual' else 'ai' end
      from supplylink_private.stock_plans sp cross join lateral jsonb_array_elements(sp.rows) r(value)
      where sp.id=(p_payload->>'planId')::uuid and rt.plan_id=sp.id and rt.product_id=(r.value->>'productId')::uuid;
    end if;
    return result;
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

-- Include target and unit in HQ's existing notification data without changing navigation or other tabs.
alter function supplylink_private.refill_notifications(uuid) rename to refill_notifications_pre_workspace;
revoke all on function supplylink_private.refill_notifications_pre_workspace(uuid) from public,anon,authenticated;
create function supplylink_private.refill_notifications(p_branch uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_set(n.value,'{refillRequests}',coalesce((select jsonb_agg(r.value||jsonb_build_object('target',rt.target,'unit',coalesce(rt.stock_unit,'pairs')) order by r.ordinality)
    from jsonb_array_elements(n.value->'refillRequests') with ordinality r(value,ordinality)
    left join supplylink_private.reserve_targets rt on rt.branch_id=(r.value->>'branchId')::uuid and rt.product_id=(r.value->>'productId')::uuid),'[]'::jsonb))
  from (select supplylink_private.refill_notifications_pre_workspace(p_branch) value) n;
$$;
revoke all on function supplylink_private.refill_notifications(uuid) from public,anon,authenticated;

-- Existing branch setup also records manual ownership of its edited target.
create function supplylink_private.workflow_with_backup_settings(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=supplylink_private.workflow_with_stock_pools(p_action,p_payload,p_key);
  if p_action='backup_configure' then
    update supplylink_private.reserve_targets set plan_source='manual'
      where branch_id=(p_payload->>'branchId')::uuid and product_id=(p_payload->>'productId')::uuid;
  end if;
  return result;
end; $$;
revoke all on function supplylink_private.workflow_with_backup_settings(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_with_backup_settings(text,jsonb,uuid) to authenticated;
create or replace function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$ select supplylink_private.workflow_with_backup_settings(p_action,p_payload,p_key); $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
