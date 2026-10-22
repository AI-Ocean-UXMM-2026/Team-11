begin;
alter table supplylink_private.delivery_runs add column accepted_at timestamptz;
-- Preserve already-running groups without asking drivers to accept work already collected.
update supplylink_private.delivery_runs r set accepted_at=(
  select min(a.picked_up_at) from supplylink_private.delivery_run_stops s
  join public.delivery_attempts a on a.id=s.attempt_id where s.run_id=r.id
) where exists(select 1 from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id where s.run_id=r.id and a.picked_up_at is not null);

create function public.driver_delivery_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); result jsonb;
begin
  if actor.role<>'driver' then raise exception 'Only drivers can view their pickup groups.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(g.data order by g.created_at,g.id),'[]'::jsonb) into result from (
    select r.id,r.created_at,jsonb_build_object('id',r.id,'acceptedAt',r.accepted_at,
      'sourceName',coalesce(b.name,'STT Yangon HQ'),'stops',(
        select jsonb_agg(jsonb_build_object('orderId',o.id,'attemptId',a.id,'position',s.position,
          'reference',o.reference,'business',o.business_name,'pairs',o.item_count,'status',o.status,
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

create function public.driver_delivery_group_action(p_run uuid,p_action text,p_orders uuid[],p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); run supplylink_private.delivery_runs;
  cached public.workflow_operations; fingerprint text; target uuid; result jsonb; publisher jsonb; stops uuid[];
begin
  if actor.role<>'driver' then raise exception 'Only the assigned driver can update a pickup group.' using errcode='42501'; end if;
  if p_key is null or p_run is null or p_action is null or p_action not in ('accept','pickup') then raise exception 'Invalid group action.'; end if;
  if p_orders is null or array_position(p_orders,null) is not null or cardinality(p_orders)>8
    or (select count(distinct x) from unnest(p_orders) x)<>cardinality(p_orders)
    or (p_action='accept' and cardinality(p_orders)<>0) or (p_action='pickup' and cardinality(p_orders)=0)
    then raise exception 'Check the parcels you have collected.'; end if;
  select array_agg(x order by x) into stops from unnest(p_orders) x;
  fingerprint:=md5('driver_group:'||p_run::text||p_action||coalesce(stops::text,'{}'));
  -- Same lock order as GPS and every grouped lifecycle change.
  perform pg_advisory_xact_lock(hashtextextended('delivery-gps:'||actor.id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into run from supplylink_private.delivery_runs where id=p_run and driver_id=actor.id for update;
  if not found then raise exception 'Delivery group unavailable.' using errcode='42501'; end if;
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;
  if not exists(select 1 from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id
    where s.run_id=p_run and a.active and a.driver_id=actor.id and a.status in ('planned','dispatched','held'))
    then raise exception 'This delivery group is no longer active.'; end if;
  if p_action='accept' then
    if run.accepted_at is null then
      update supplylink_private.delivery_runs set accepted_at=clock_timestamp() where id=p_run;
      insert into public.audit_events(actor_id,action,subject_id) values(actor.id,'delivery.group_accept',p_run);
    end if;
    result:=jsonb_build_object('message','Group accepted. Check each parcel after collecting it. Location sharing has not started.');
  else
    if run.accepted_at is null then raise exception 'Accept this delivery group before confirming pickup.'; end if;
    -- Validate membership before invoking any parcel transitions. Any failure rolls the entire batch back.
    if (select count(*) from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id
      where s.run_id=p_run and a.order_id=any(p_orders) and a.active and a.driver_id=actor.id)<>cardinality(p_orders)
      then raise exception 'A selected parcel is no longer assigned to this group.'; end if;
    for target in select unnest(stops) loop
      perform public.workflow_execute('pickup',jsonb_build_object('orderId',target),gen_random_uuid());
    end loop;
    select jsonb_build_object('orderId',o.id,'attemptId',a.id,'reference',o.reference) into publisher
      from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id
      join public.orders o on o.id=a.order_id where s.run_id=p_run and a.active and a.driver_id=actor.id
        and a.status='dispatched' and a.picked_up_at is not null and o.status='Shipping'
        and not o.has_open_issue and not o.handoff_pending and not o.replacement_required
      order by s.position limit 1;
    result:=jsonb_build_object('message','Pickup confirmed for checked parcels. Location sharing can now start.','publisher',publisher);
    insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'delivery.group_pickup',p_run,jsonb_build_object('orders',p_orders));
  end if;
  insert into public.workflow_operations(actor_id,operation_key,fingerprint,result) values(actor.id,p_key,fingerprint,result);
  return result;
end; $$;
revoke all on function public.driver_delivery_group_action(uuid,text,uuid[],uuid) from public,anon;
grant execute on function public.driver_delivery_group_action(uuid,text,uuid[],uuid) to authenticated;

create or replace function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); group_driver uuid; accepted timestamptz;
begin
  if p_payload->>'orderId' is not null then
    select r.driver_id,r.accepted_at into group_driver,accepted from supplylink_private.delivery_run_stops s
      join supplylink_private.delivery_runs r on r.id=s.run_id join public.delivery_attempts a on a.id=s.attempt_id
      where a.order_id=(p_payload->>'orderId')::uuid and a.active limit 1;
    if group_driver is not null then
      perform pg_advisory_xact_lock(hashtextextended('delivery-gps:'||group_driver::text,0));
      if p_action='pickup' and accepted is null then raise exception 'Accept this delivery group before confirming pickup.'; end if;
    end if;
  end if;
  return supplylink_private.workflow_execute_before_groups(p_action,p_payload,p_key);
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;
-- Collected parcels route only through other collected stops.
create or replace function public.workflow_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); result jsonb; v_run_id uuid; own_pos integer; stops jsonb; publisher jsonb;
begin
  result:=supplylink_private.workflow_tracking_before_groups(p_order);
  select s.run_id,s.position into v_run_id,own_pos from supplylink_private.delivery_run_stops s
    join public.delivery_attempts a on a.id=s.attempt_id where a.id=(result->>'attemptId')::uuid;
  if v_run_id is null or (actor.role='sme' and result->>'state'='stopped') then return result; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object('position',s.position,'own',o.id=p_order,'pin',jsonb_build_object('latitude',o.latitude,'longitude',o.longitude)) ||
    case when actor.role in ('hq','driver') then jsonb_build_object('orderId',o.id,'reference',o.reference,'business',o.business_name,'status',o.status) else '{}'::jsonb end
    order by s.position),'[]'::jsonb) into stops
    from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id join public.orders o on o.id=a.order_id
    where s.run_id=v_run_id and a.active and a.status in ('planned','dispatched','held') and o.status not in ('Complete','Done','Cancelled')
      and (result->>'pickedUpAt' is null or a.picked_up_at is not null)
      and (actor.role in ('hq','driver') or s.position<=own_pos);
  if actor.role='driver' then
    select jsonb_build_object('orderId',o.id,'attemptId',a.id,'reference',o.reference) into publisher
      from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id join public.orders o on o.id=a.order_id
      where s.run_id=v_run_id and a.driver_id=actor.id and a.active and a.status='dispatched' and a.picked_up_at is not null
        and o.status='Shipping' and not o.has_open_issue and not o.handoff_pending and not o.replacement_required order by s.position limit 1;
  end if;
  return result||jsonb_build_object('run',jsonb_build_object('stops',stops)||case when actor.role='driver' then jsonb_build_object('publisher',publisher) else '{}'::jsonb end);
end; $$;
revoke all on function public.workflow_tracking(uuid) from public,anon;
grant execute on function public.workflow_tracking(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
