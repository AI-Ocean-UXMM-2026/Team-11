begin;

-- Membership is private. Customers receive only an explicit, redacted projection.
create table supplylink_private.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  source_branch_id uuid references public.branches(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index delivery_runs_driver on supplylink_private.delivery_runs(driver_id);
create table supplylink_private.delivery_run_stops (
  run_id uuid not null references supplylink_private.delivery_runs(id),
  attempt_id uuid primary key references public.delivery_attempts(id),
  position integer not null check(position between 1 and 8),
  unique(run_id,position)
);
alter table supplylink_private.delivery_runs enable row level security;
alter table supplylink_private.delivery_run_stops enable row level security;
revoke all on supplylink_private.delivery_runs,supplylink_private.delivery_run_stops from public,anon,authenticated;

create function public.delivery_dispatch_candidates() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor();
begin
  if actor.role not in ('hq','branch') then raise exception 'Only HQ or branch staff can plan deliveries.' using errcode='42501'; end if;
  return jsonb_build_object('orders',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'reference',o.reference,'business',o.business_name,'sourceBranchId',o.source_branch_id,'sourceName',o.source_name,
    'pin',jsonb_build_object('latitude',o.latitude,'longitude',o.longitude),
    'sourcePin',case when b.latitude is null then null else jsonb_build_object('latitude',b.latitude,'longitude',b.longitude) end
  ) order by o.created_at,o.id) from (
    select x.* from public.orders x where x.status in ('Confirmed','Preparing') and not x.has_open_issue and not x.handoff_pending and not x.replacement_required
      and x.dispatched_at is null and x.latitude is not null and (actor.role='hq' or x.source_branch_id=actor.branch_id)
      and not exists(select 1 from public.delivery_attempts a join supplylink_private.delivery_run_stops s on s.attempt_id=a.id where a.order_id=x.id and a.active)
    order by x.created_at,x.id limit 100
  ) o left join public.branches b on b.id=o.source_branch_id),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'branchId',d.branch_id) order by d.name,d.id)
    from public.profiles d where d.role='driver' and d.status='active' and not d.must_change_password
      and (d.branch_id is null or exists(select 1 from public.branches b where b.id=d.branch_id and b.active))
      and (actor.role='hq' or d.branch_id=actor.branch_id)),'[]'::jsonb));
end; $$;
revoke all on function public.delivery_dispatch_candidates() from public,anon;
grant execute on function public.delivery_dispatch_candidates() to authenticated;

create function public.delivery_group_assign(p_orders uuid[],p_driver uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); driver public.profiles; o public.orders;
  run_id uuid; target uuid; attempt uuid; pos integer:=0; cached public.workflow_operations; fingerprint text; result jsonb;
begin
  if actor.role not in ('hq','branch') then raise exception 'Only HQ or branch staff can plan deliveries.' using errcode='42501'; end if;
  if p_key is null or p_orders is null or cardinality(p_orders) not between 2 and 8 or array_position(p_orders,null) is not null
    or (select count(distinct x) from unnest(p_orders) x)<>cardinality(p_orders)
    then raise exception 'Choose two to eight distinct orders.'; end if;
  fingerprint:=md5('delivery_group_assign'||p_orders::text||coalesce(p_driver::text,''));
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;
  select * into driver from public.profiles where id=p_driver and role='driver' and status='active' and not must_change_password for update;
  if not found or (actor.role='branch' and driver.branch_id is distinct from actor.branch_id) then raise exception 'Choose an active driver at your fulfilment location.'; end if;
  if driver.branch_id is not null then
    perform 1 from public.branches where id=driver.branch_id and active for share;
    if not found then raise exception 'This branch is closed.'; end if;
  end if;
  perform id from public.orders where id=any(p_orders) order by id for update;
  if (select count(*) from public.orders where id=any(p_orders))<>cardinality(p_orders) then raise exception 'One or more orders are unavailable.'; end if;
  if exists(select 1 from public.delivery_attempts a where a.driver_id=p_driver and a.active and a.status in ('planned','dispatched','held') and not(a.order_id=any(p_orders))) then
    raise exception 'This driver already has other active deliveries. Finish or reassign them before creating a group.';
  end if;
  foreach target in array p_orders loop
    select * into o from public.orders where id=target;
    if o.status not in ('Confirmed','Preparing') or o.has_open_issue or o.handoff_pending or o.replacement_required or o.dispatched_at is not null
      or o.latitude is null or o.source_branch_id is distinct from driver.branch_id then raise exception 'Choose confirmed, pinned orders from the same fulfilment location.'; end if;
    if exists(select 1 from public.delivery_attempts a join supplylink_private.delivery_run_stops s on s.attempt_id=a.id where a.order_id=target and a.active)
      then raise exception 'An order is already grouped. Refresh the delivery plan.'; end if;
  end loop;
  insert into supplylink_private.delivery_runs(driver_id,source_branch_id,created_by) values(p_driver,driver.branch_id,actor.id) returning id into run_id;
  foreach target in array p_orders loop
    perform public.workflow_execute('assign',jsonb_build_object('orderId',target,'driverId',p_driver),gen_random_uuid());
    select id into attempt from public.delivery_attempts where order_id=target and active;
    pos:=pos+1;
    insert into supplylink_private.delivery_run_stops values(run_id,attempt,pos);
    insert into public.order_events(order_id,actor_id,action,reason) values(target,actor.id,'group_delivery','Stop '||pos::text||' in an ordered delivery group');
  end loop;
  result:=jsonb_build_object('runId',run_id,'message','Delivery group assigned. Prepare, dispatch and confirm pickup for each order.');
  insert into public.workflow_operations values(actor.id,p_key,fingerprint,result);
  insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'delivery.group_assign',run_id,jsonb_build_object('orders',p_orders,'driverId',p_driver));
  return result;
end; $$;
revoke all on function public.delivery_group_assign(uuid[],uuid,uuid) from public,anon;
grant execute on function public.delivery_group_assign(uuid[],uuid,uuid) to authenticated;

alter function public.workflow_tracking(uuid) rename to workflow_tracking_before_groups;
alter function public.workflow_tracking_before_groups(uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_tracking_before_groups(uuid) from public,anon,authenticated;
create function public.workflow_tracking(p_order uuid) returns jsonb
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

alter function public.workflow_tracking_publish(uuid,uuid,text,jsonb) rename to workflow_tracking_publish_before_groups;
alter function public.workflow_tracking_publish_before_groups(uuid,uuid,text,jsonb) set schema supplylink_private;
revoke all on function supplylink_private.workflow_tracking_publish_before_groups(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.workflow_tracking_publish(p_order uuid,p_attempt uuid,p_state text,p_point jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); sibling record;
begin
  perform pg_advisory_xact_lock(hashtextextended('delivery-gps:'||actor.id::text,0));
  -- Validate the anchor first; clients cannot use group membership to bypass pickup or assignment checks.
  perform supplylink_private.workflow_tracking_publish_before_groups(p_order,p_attempt,p_state,p_point);
  for sibling in select a.id,a.order_id from supplylink_private.delivery_run_stops s
    join public.delivery_attempts a on a.id=s.attempt_id join public.orders o on o.id=a.order_id
    where s.run_id=(select run_id from supplylink_private.delivery_run_stops where attempt_id=p_attempt)
      and a.id<>p_attempt and a.driver_id=actor.id and a.active and a.status='dispatched' and a.picked_up_at is not null
      and o.status='Shipping' and not o.has_open_issue and not o.handoff_pending and not o.replacement_required order by a.order_id
  loop
    perform supplylink_private.workflow_tracking_publish_before_groups(sibling.order_id,sibling.id,p_state,p_point);
  end loop;
end; $$;
revoke all on function public.workflow_tracking_publish(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.workflow_tracking_publish(uuid,uuid,text,jsonb) to authenticated;

-- Wake subscriptions for remaining stops when a preceding delivery changes.
create function supplylink_private.notify_delivery_run() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.delivery_tracking t set updated_at=clock_timestamp()
    where t.attempt_id<>new.id and t.attempt_id in (
      select s.attempt_id from supplylink_private.delivery_run_stops s
      where s.run_id=(select run_id from supplylink_private.delivery_run_stops where attempt_id=new.id));
  return new;
end; $$;
revoke all on function supplylink_private.notify_delivery_run() from public,anon,authenticated;
create trigger delivery_run_attempt_changed after update of status,active,picked_up_at on public.delivery_attempts
  for each row execute function supplylink_private.notify_delivery_run();

-- Lifecycle writes and GPS fan-out acquire the same driver lock before order
-- locks, preventing a handover on one stop deadlocking a GPS update on another.
alter function public.workflow_execute(text,jsonb,uuid) rename to workflow_execute_before_groups;
alter function public.workflow_execute_before_groups(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_before_groups(text,jsonb,uuid) from public,anon,authenticated;
create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); group_driver uuid;
begin
  if p_payload->>'orderId' is not null then
    select r.driver_id into group_driver from supplylink_private.delivery_run_stops s
      join supplylink_private.delivery_runs r on r.id=s.run_id join public.delivery_attempts a on a.id=s.attempt_id
      where a.order_id=(p_payload->>'orderId')::uuid and a.active limit 1;
    if group_driver is not null then
      perform pg_advisory_xact_lock(hashtextextended('delivery-gps:'||group_driver::text,0));
    end if;
  end if;
  return supplylink_private.workflow_execute_before_groups(p_action,p_payload,p_key);
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;
commit;
