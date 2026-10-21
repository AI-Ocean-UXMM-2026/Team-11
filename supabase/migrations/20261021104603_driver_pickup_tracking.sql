begin;
alter table public.delivery_attempts add column picked_up_at timestamptz;
-- Preserve handovers already recorded before pickup confirmation existed.
update public.delivery_attempts set picked_up_at=dispatched_at where status='handed_over';

-- Only the latest fix is needed for the delivery map. No public route history.
create table public.delivery_tracking (
  attempt_id uuid primary key references public.delivery_attempts(id),
  order_id uuid not null references public.orders(id),
  driver_id uuid not null references public.profiles(id),
  state text not null check(state in ('awaiting_pickup','sharing','paused','unavailable','stopped')),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  accuracy_m double precision check(accuracy_m between 0 and 100000),
  captured_at timestamptz,
  received_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((latitude is null and longitude is null and accuracy_m is null and captured_at is null and received_at is null)
    or (latitude is not null and longitude is not null and accuracy_m is not null and captured_at is not null and received_at is not null))
);
create index delivery_tracking_order on public.delivery_tracking(order_id);
alter table public.delivery_tracking enable row level security;
revoke all on public.delivery_tracking from public,anon,authenticated;
grant select on public.delivery_tracking to authenticated;
grant all on public.delivery_tracking to service_role;
revoke all on public.driver_locations from anon,authenticated;

create function supplylink_private.tracking_allowed(p_order uuid,p_driver uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.orders o on o.id=p_order
    where p.id=auth.uid() and p.status='active' and not p.must_change_password
      and (p.branch_id is null or exists(select 1 from public.branches b where b.id=p.branch_id and b.active))
      and (p.role='hq' or (p.role='sme' and o.sme_id=p.id) or (p.role='driver' and p.id=p_driver)))
$$;
revoke all on function supplylink_private.tracking_allowed(uuid,uuid) from public,anon;
grant usage on schema supplylink_private to authenticated;
grant execute on function supplylink_private.tracking_allowed(uuid,uuid) to authenticated;
create policy delivery_tracking_read on public.delivery_tracking for select to authenticated
  using (supplylink_private.tracking_allowed(order_id,driver_id));

create function supplylink_private.sync_tracking(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.delivery_attempts; o public.orders; d public.profiles; current_state text; next_state text; clear_point boolean;
begin
  select * into o from public.orders where id=p_order;
  for a in select * from public.delivery_attempts where order_id=p_order and driver_id is not null loop
    select * into d from public.profiles where id=a.driver_id;
    clear_point:=not a.active or a.status in ('handed_over','replaced','cancelled') or o.status in ('Done','Cancelled','Complete')
      or d.status<>'active' or d.must_change_password;
    select state into current_state from public.delivery_tracking where attempt_id=a.id;
    next_state:=case
      when clear_point then 'stopped'
      when o.has_open_issue or o.status='On hold' or a.status='held' then 'paused'
      when a.picked_up_at is null then 'awaiting_pickup'
      when o.status<>'Shipping' or a.status<>'dispatched' then 'unavailable'
      else case when current_state in ('sharing','paused','unavailable') then current_state else 'unavailable' end end;
    insert into public.delivery_tracking(attempt_id,order_id,driver_id,state) values(a.id,o.id,a.driver_id,next_state)
    on conflict(attempt_id) do update set state=excluded.state,
      latitude=case when clear_point then null else delivery_tracking.latitude end,
      longitude=case when clear_point then null else delivery_tracking.longitude end,
      accuracy_m=case when clear_point then null else delivery_tracking.accuracy_m end,
      captured_at=case when clear_point then null else delivery_tracking.captured_at end,
      received_at=case when clear_point then null else delivery_tracking.received_at end,
      updated_at=clock_timestamp()
    where delivery_tracking.state is distinct from excluded.state or (clear_point and delivery_tracking.latitude is not null);
  end loop;
end; $$;
revoke all on function supplylink_private.sync_tracking(uuid) from public,anon,authenticated;

create function supplylink_private.tracking_transition() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='orders' then perform supplylink_private.sync_tracking(new.id);
  elsif tg_table_name='delivery_attempts' then perform supplylink_private.sync_tracking(new.order_id);
  else
    for target in select distinct order_id from public.delivery_attempts where driver_id=new.id and active loop
      perform supplylink_private.sync_tracking(target);
    end loop;
  end if;
  return new;
end; $$;
revoke all on function supplylink_private.tracking_transition() from public,anon,authenticated;
create trigger tracking_order_transition after update on public.orders for each row execute function supplylink_private.tracking_transition();
create trigger tracking_attempt_transition after insert or update on public.delivery_attempts for each row execute function supplylink_private.tracking_transition();
create trigger tracking_driver_transition after update of status,must_change_password on public.profiles for each row
  when (old.status is distinct from new.status or old.must_change_password is distinct from new.must_change_password)
  execute function supplylink_private.tracking_transition();
do $$ declare target uuid; begin
  for target in select distinct order_id from public.delivery_attempts where active loop perform supplylink_private.sync_tracking(target); end loop;
end; $$;

alter function public.workflow_execute(text,jsonb,uuid) rename to workflow_execute_before_tracking;
alter function public.workflow_execute_before_tracking(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_before_tracking(text,jsonb,uuid) from public,anon,authenticated;
create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; o public.orders; a public.delivery_attempts; cached public.workflow_operations; result jsonb; fingerprint text;
begin
  if p_action not in ('pickup','handover') then return supplylink_private.workflow_execute_before_tracking(p_action,p_payload,p_key); end if;
  actor:=supplylink_private.workspace_actor();
  if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Payload and retry key are required.'; end if;
  if p_action='handover' then
    select * into o from public.orders where id=(p_payload->>'orderId')::uuid for update;
    select * into a from public.delivery_attempts where order_id=o.id and active for update;
    if a.id is not null and a.picked_up_at is null then raise exception 'Confirm pickup before reporting handover.'; end if;
    return supplylink_private.workflow_execute_before_tracking(p_action,p_payload,p_key);
  end if;
  fingerprint:=md5(p_action||p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;
  select * into o from public.orders where id=(p_payload->>'orderId')::uuid for update;
  select * into a from public.delivery_attempts where order_id=o.id and active for update;
  if actor.role<>'driver' or a.id is null or a.driver_id<>actor.id or o.status<>'Shipping' or o.has_open_issue
    or o.handoff_pending or o.replacement_required or a.status<>'dispatched'
    then raise exception 'Only the assigned driver can confirm pickup after dispatch.'; end if;
  if a.picked_up_at is null then
    update public.delivery_attempts set picked_up_at=clock_timestamp() where id=a.id;
    insert into public.order_events(order_id,actor_id,action) values(o.id,actor.id,'pickup');
    insert into public.audit_events(actor_id,action,subject_id) values(actor.id,'workflow.pickup',o.id);
  end if;
  result:=jsonb_build_object('orderId',o.id,'attemptId',a.id,'message','Pickup confirmed. Delivery started.');
  insert into public.workflow_operations values(actor.id,p_key,fingerprint,result);
  return result;
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

-- Add pickup metadata to bounded order pages without duplicating the list query.
alter function public.workflow_list(text,jsonb) rename to workflow_list_before_tracking;
alter function public.workflow_list_before_tracking(text,jsonb) set schema supplylink_private;
revoke all on function supplylink_private.workflow_list_before_tracking(text,jsonb) from public,anon,authenticated;
create function public.workflow_list(p_kind text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; patched jsonb;
begin
  result:=supplylink_private.workflow_list_before_tracking(p_kind,p_query);
  if p_kind='orders' then
    select coalesce(jsonb_agg(jsonb_set(row.value,'{workflow}',row.value->'workflow'||jsonb_build_object('attemptId',a.id,'pickedUpAt',a.picked_up_at)) order by row.ordinality),'[]'::jsonb) into patched
      from jsonb_array_elements(result->'rows') with ordinality as row(value,ordinality)
      left join lateral (select * from public.delivery_attempts where order_id=(row.value->>'id')::uuid order by active desc,created_at desc,id desc limit 1) a on true;
    result:=jsonb_set(result,'{rows}',patched);
  end if;
  return result;
end; $$;
revoke all on function public.workflow_list(text,jsonb) from public,anon;
grant execute on function public.workflow_list(text,jsonb) to authenticated;

create function public.workflow_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); o public.orders; a public.delivery_attempts; t public.delivery_tracking; b public.branches; eligible boolean;
begin
  select * into o from public.orders where id=p_order;
  select * into a from public.delivery_attempts where order_id=p_order order by active desc,created_at desc,id desc limit 1;
  if o.id is null or not supplylink_private.tracking_allowed(o.id,a.driver_id) then raise exception 'This delivery is unavailable to this account.' using errcode='42501'; end if;
  select * into t from public.delivery_tracking where attempt_id=a.id;
  select * into b from public.branches where id=o.source_branch_id;
  eligible:=coalesce(a.active and a.status='dispatched' and a.picked_up_at is not null and o.status='Shipping'
    and not o.has_open_issue and not o.handoff_pending and not o.replacement_required
    and exists(select 1 from public.profiles d where d.id=a.driver_id and d.role='driver' and d.status='active' and not d.must_change_password
      and (d.branch_id is null or exists(select 1 from public.branches x where x.id=d.branch_id and x.active))),false);
  return jsonb_build_object('orderId',o.id,'reference',o.reference,'status',o.status,'attemptId',a.id,'driverId',a.driver_id,
    'pickedUpAt',a.picked_up_at,'canPublish',eligible,'state',coalesce(t.state,'awaiting_pickup'),
    'source',jsonb_build_object('name',o.source_name,'pin',case when b.latitude is null then null else jsonb_build_object('latitude',b.latitude,'longitude',b.longitude) end),
    'destination',case when o.latitude is null then null else jsonb_build_object('latitude',o.latitude,'longitude',o.longitude) end,
    'point',case when t.latitude is null or t.state='stopped' then null else jsonb_build_object('latitude',t.latitude,'longitude',t.longitude,'accuracy',t.accuracy_m,'capturedAt',t.captured_at,'receivedAt',t.received_at) end);
end; $$;
revoke all on function public.workflow_tracking(uuid) from public,anon;
grant execute on function public.workflow_tracking(uuid) to authenticated;

create function public.workflow_tracking_publish(p_order uuid,p_attempt uuid,p_state text,p_point jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); o public.orders; a public.delivery_attempts; t public.delivery_tracking; captured timestamptz; received timestamptz:=clock_timestamp(); lat double precision; lng double precision; accuracy double precision;
begin
  select * into o from public.orders where id=p_order for update;
  select * into a from public.delivery_attempts where id=p_attempt and order_id=p_order and active for update;
  if actor.role<>'driver' or a.id is null or a.driver_id<>actor.id or a.picked_up_at is null or a.status<>'dispatched'
    or o.status<>'Shipping' or o.has_open_issue or o.handoff_pending or o.replacement_required
    then raise exception 'Location sharing is unavailable for this assignment.' using errcode='42501'; end if;
  if p_state is null or p_state not in ('sharing','paused','unavailable') then raise exception 'Invalid sharing state.'; end if;
  select * into t from public.delivery_tracking where attempt_id=a.id for update;
  if p_state='sharing' then
    if jsonb_typeof(p_point) is distinct from 'object' or jsonb_typeof(p_point->'latitude') is distinct from 'number'
      or jsonb_typeof(p_point->'longitude') is distinct from 'number' or jsonb_typeof(p_point->'accuracy') is distinct from 'number'
      or jsonb_typeof(p_point->'capturedAt') is distinct from 'string' then raise exception 'A valid GPS position is required.'; end if;
    lat:=(p_point->>'latitude')::double precision; lng:=(p_point->>'longitude')::double precision; accuracy:=(p_point->>'accuracy')::double precision; captured:=(p_point->>'capturedAt')::timestamptz;
    if not (lat between -90 and 90 and lng between -180 and 180 and accuracy between 0 and 100000)
      or not (captured between received-interval '60 seconds' and received+interval '5 seconds')
      then raise exception 'GPS coordinates or capture time are invalid. Request a fresh position.'; end if;
    if t.captured_at is not null and captured<=t.captured_at then raise exception 'An older GPS position cannot replace the latest location.'; end if;
    -- Bound accepted writes while allowing a fresh fix immediately after resuming.
    if t.state='sharing' and t.received_at>received-interval '10 seconds' then return; end if;
    update public.delivery_tracking set state='sharing',latitude=lat,longitude=lng,accuracy_m=accuracy,captured_at=captured,received_at=received,updated_at=received where attempt_id=a.id;
  else
    update public.delivery_tracking set state=p_state,updated_at=received where attempt_id=a.id and state is distinct from p_state;
  end if;
end; $$;
revoke all on function public.workflow_tracking_publish(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.workflow_tracking_publish(uuid,uuid,text,jsonb) to authenticated;

-- PGlite has no realtime publication. Hosted Supabase uses RLS for every event.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.delivery_tracking;
  end if;
end; $$;
commit;
