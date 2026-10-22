-- HQ-reviewed monthly wholesale reserves. All numeric results are database-derived.
begin;
create table supplylink_private.planning_config (
  singleton boolean primary key default true check(singleton), observed_since timestamptz not null default now()
);
insert into supplylink_private.planning_config(singleton) values(true);
create table supplylink_private.stock_observations (
  id bigint generated always as identity primary key, branch_id uuid references public.branches(id),
  product_id uuid not null references public.products(id), on_hand integer not null,
  allocated integer not null, protected integer not null, observed_at timestamptz not null default now(), actor_id uuid
);
create index stock_observations_lookup on supplylink_private.stock_observations(branch_id,product_id,observed_at,id);
create table supplylink_private.backup_declines (
  handoff_id uuid primary key references public.delivery_handoffs(id),
  cause text not null check(cause in ('stock_shortage','capacity','other','unknown'))
);
create table supplylink_private.backup_unmet (
  order_id uuid primary key references public.orders(id), lines jsonb not null, reason text not null,
  actor_id uuid not null references public.profiles(id), recorded_at timestamptz not null default now()
);
create table supplylink_private.planning_arrivals (
  transfer_id uuid primary key references public.stock_transfers(id), due date not null,
  reason text not null, actor_id uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table supplylink_private.stock_plans (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id),
  month date not null check(extract(day from month)=1), version integer not null,
  status text not null default 'draft' check(status in ('draft','approved','superseded')),
  buffer integer not null, min_months integer not null, min_orders integer not null,
  inputs jsonb not null, rows jsonb not null, fingerprint text not null,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id), approved_at timestamptz, approval_reason text,
  explanation jsonb not null default '{"status":"none"}', explanation_token uuid, explanation_requested_at timestamptz,
  unique(branch_id,month,version)
);
create index stock_plans_month on supplylink_private.stock_plans(branch_id,month,version desc);
create unique index stock_plans_approved on supplylink_private.stock_plans(branch_id,month) where status='approved';
create table supplylink_private.reserve_targets (
  branch_id uuid not null references public.branches(id), product_id uuid not null references public.products(id),
  target integer not null, plan_id uuid not null references supplylink_private.stock_plans(id),
  primary key(branch_id,product_id)
);
create table supplylink_private.planning_explanation_attempts (
  id bigint generated always as identity primary key, plan_id uuid not null references supplylink_private.stock_plans(id),
  requested_at timestamptz not null default now()
);
create index planning_explanation_daily on supplylink_private.planning_explanation_attempts(requested_at);
alter table supplylink_private.planning_config enable row level security;
alter table supplylink_private.stock_observations enable row level security;
alter table supplylink_private.backup_declines enable row level security;
alter table supplylink_private.backup_unmet enable row level security;
alter table supplylink_private.planning_arrivals enable row level security;
alter table supplylink_private.stock_plans enable row level security;
alter table supplylink_private.reserve_targets enable row level security;
alter table supplylink_private.planning_explanation_attempts enable row level security;
revoke all on supplylink_private.planning_config,supplylink_private.stock_observations,supplylink_private.backup_declines,
  supplylink_private.backup_unmet,supplylink_private.planning_arrivals,supplylink_private.stock_plans,
  supplylink_private.reserve_targets,supplylink_private.planning_explanation_attempts from public,anon,authenticated;

create function supplylink_private.observe_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or (new.on_hand,new.allocated,new.protected_reserve) is distinct from (old.on_hand,old.allocated,old.protected_reserve) then
    insert into supplylink_private.stock_observations(branch_id,product_id,on_hand,allocated,protected,actor_id)
      values(new.branch_id,new.product_id,new.on_hand,new.allocated,new.protected_reserve,auth.uid());
  end if;
  return new;
end; $$;
revoke all on function supplylink_private.observe_stock() from public,anon,authenticated;
create trigger planning_observe_stock after insert or update on public.inventory for each row execute function supplylink_private.observe_stock();
insert into supplylink_private.stock_observations(branch_id,product_id,on_hand,allocated,protected)
  select branch_id,product_id,on_hand,allocated,protected_reserve from public.inventory;

-- Record structured decline causes without changing the existing transactional workflow.
alter function public.workflow_execute(text,jsonb,uuid) rename to workflow_execute_pre_planning;
alter function public.workflow_execute_pre_planning(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_pre_planning(text,jsonb,uuid) from public,anon,authenticated;
create function supplylink_private.workflow_with_planning(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; cause text:=coalesce(p_payload->>'declineCause','unknown');
begin
  if p_action='handoff_decline' and cause not in ('stock_shortage','capacity','other','unknown') then raise exception 'Choose a valid decline category.'; end if;
  result:=supplylink_private.workflow_execute_pre_planning(p_action,p_payload,p_key);
  if p_action='handoff_decline' then
    insert into supplylink_private.backup_declines(handoff_id,cause) values((p_payload->>'handoffId')::uuid,cause) on conflict do nothing;
  end if;
  return result;
end; $$;
revoke all on function supplylink_private.workflow_with_planning(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_with_planning(text,jsonb,uuid) to authenticated;
create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$
  select supplylink_private.workflow_with_planning(p_action,p_payload,p_key);
$$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

create function supplylink_private.planning_rows(p_branch uuid,p_month date,p_buffer integer,p_min_months integer,p_min_orders integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare history_end date:=least(p_month,date_trunc('month',now() at time zone 'Asia/Yangon')::date);
  history_start date; since timestamptz; result jsonb;
begin
  history_start:=(history_end-interval '3 months')::date;
  select greatest(c.observed_since,b.created_at) into since from supplylink_private.planning_config c cross join public.branches b where b.id=p_branch;
  with canonical as (
    -- One demand belongs to one branch: accepted source, otherwise earliest structured stock-shortage decline.
    select distinct on(h.order_id) h.order_id,h.branch_id,min(h.created_at) over(partition by h.order_id) created_at
    from public.delivery_handoffs h left join supplylink_private.backup_declines d on d.handoff_id=h.id
    where h.status='accepted' or (h.status='declined' and d.cause='stock_shortage')
    order by h.order_id,(h.status='accepted') desc,h.created_at,h.id
  ), demand as (
    select l.product_id,sum(l.quantity)::integer units,count(distinct h.order_id)::integer orders
    from canonical h join public.order_lines l on l.order_id=h.order_id
    where h.branch_id=p_branch and h.created_at>=history_start::timestamp at time zone 'Asia/Yangon'
      and h.created_at<history_end::timestamp at time zone 'Asia/Yangon' group by l.product_id
  ), retail as (
    select l.product_id,sum(l.quantity)::integer units from public.retail_sales s join public.retail_sale_lines l on l.sale_id=s.id
    where s.branch_id=p_branch and s.confirmed_at>=history_start::timestamp at time zone 'Asia/Yangon'
      and s.confirmed_at<history_end::timestamp at time zone 'Asia/Yangon' group by l.product_id
  ), incoming as (
    select t.product_id,sum(t.quantity)::integer units from public.stock_transfers t
    join supplylink_private.planning_arrivals a on a.transfer_id=t.id
    where t.destination_branch_id=p_branch and t.status='shipping' and a.due<=p_month
      and a.due>=(now() at time zone 'Asia/Yangon')::date group by t.product_id
  ), intervals as (
    select product_id,on_hand-allocated-protected available,observed_at,
      lead(observed_at,1,now()) over(partition by product_id order by observed_at,id) until
    from supplylink_private.stock_observations where branch_id=p_branch
  ), stockouts as (
    select product_id,round(sum(greatest(0,extract(epoch from (least(until,history_end::timestamp at time zone 'Asia/Yangon')-
      greatest(observed_at,history_start::timestamp at time zone 'Asia/Yangon')))))/86400,1) days
    from intervals where available=0 group by product_id
  ), facts as (
    select p.id,p.pack,coalesce(i.on_hand,0) on_hand,coalesce(i.allocated,0) allocated,coalesce(i.protected_reserve,0) carryover,
      greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) retail_available,
      coalesce(d.units,0) backup_units,coalesce(d.orders,0) backup_orders,coalesce(r.units,0) retail_units,
      coalesce(n.units,0) incoming,coalesce(s.days,0) stockout_days,
      (select round(avg(extract(epoch from (tr.received_at-tr.dispatched_at)))/86400,1) from public.stock_transfers tr
        where tr.destination_branch_id=p_branch and tr.product_id=p.id and tr.status='received' and tr.received_at>=tr.dispatched_at
          and tr.received_at>=history_start::timestamp at time zone 'Asia/Yangon' and tr.received_at<history_end::timestamp at time zone 'Asia/Yangon') refill_lead_days,
      (select count(*)::integer from generate_series(history_start::timestamp,history_end::timestamp-interval '1 month',interval '1 month') m
        where m at time zone 'Asia/Yangon'>=greatest(since,p.created_at,
          coalesce((select min(observed_at) from supplylink_private.stock_observations so where so.branch_id=p_branch and so.product_id=p.id),now()))) complete_months
    from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=p_branch
    left join demand d on d.product_id=p.id left join retail r on r.product_id=p.id
    left join incoming n on n.product_id=p.id left join stockouts s on s.product_id=p.id
    where p.active and p.brand='STT'
  ) select coalesce(jsonb_agg(jsonb_build_object('productId',id,'variant',pack,'onHand',on_hand,'allocated',allocated,
    'carryover',carryover,'retailAvailable',retail_available,'incoming',incoming,'retailUnits',retail_units,
    'backupUnits',backup_units,'backupOrders',backup_orders,'completeMonths',complete_months,'stockoutDays',stockout_days,'refillLeadDays',refill_lead_days,
    'baseline',case when complete_months>=p_min_months and backup_orders>=p_min_orders then ceil(backup_units::numeric*(100+p_buffer)/300)::integer else null end,
    'target',null,'manual',false,'retailMove',0,'reason','','refill',null) order by pack,id),'[]'::jsonb) into result from facts;
  return result;
end; $$;
revoke all on function supplylink_private.planning_rows(uuid,date,integer,integer,integer) from public,anon,authenticated;

create function supplylink_private.plan_json(p supplylink_private.stock_plans) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'branchId',p.branch_id,'month',p.month,'version',p.version,'status',p.status,
   'createdAt',p.created_at,'approvedAt',p.approved_at,'approvalReason',p.approval_reason,
   'buffer',p.buffer,'minMonths',p.min_months,'minOrders',p.min_orders,'rows',p.rows,'inputs',p.inputs,'explanation',p.explanation);
$$;
revoke all on function supplylink_private.plan_json(supplylink_private.stock_plans) from public,anon,authenticated;

create function supplylink_private.stock_planning(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); b public.branches; p supplylink_private.stock_plans;
  inv public.inventory; m date; current_rows jsonb; result jsonb; row_item jsonb; overrides jsonb; edited jsonb; override_item jsonb;
  target integer; move integer; buffer integer; min_months integer; min_orders integer; v integer;
  reason text:=trim(coalesce(p_payload->>'reason','')); fingerprint text; cached public.workflow_operations;
  t public.stock_transfers; history_end date; token uuid;
begin
  if actor.role<>'hq' then raise exception 'Stock planning is restricted to HQ.' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>24000 then raise exception 'Invalid planning request.'; end if;
  if length(reason)>500 then raise exception 'Planning reasons must be at most 500 characters.'; end if;
  if p_action not in ('snapshot','claim_explanation') then
    if p_key is null then raise exception 'A retry key is required.'; end if;
    fingerprint:=md5('planning.'||p_action||p_payload::text);
    perform pg_advisory_xact_lock(hashtext(actor.id::text||p_key::text));
    select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
    if found then
      if cached.fingerprint<>fingerprint then raise exception 'Retry key already belongs to another request.'; end if;
      return cached.result;
    end if;
  end if;
  if p_action in ('snapshot','generate') then
    if coalesce(p_payload->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$' then raise exception 'Select a valid planning month.'; end if;
    m:=(p_payload->>'month')::date;
    select * into b from public.branches where id=(p_payload->>'branchId')::uuid for update;
    if not found then raise exception 'Branch not found.'; end if;
    buffer:=coalesce((p_payload->>'buffer')::integer,20); min_months:=coalesce((p_payload->>'minMonths')::integer,3); min_orders:=coalesce((p_payload->>'minOrders')::integer,5);
    if buffer not between 0 and 100 or min_months not between 1 and 3 or min_orders not between 1 and 100 then raise exception 'Invalid planning thresholds.'; end if;
    current_rows:=supplylink_private.planning_rows(b.id,m,buffer,min_months,min_orders);
  end if;
  if p_action='snapshot' then
    history_end:=least(m,date_trunc('month',now() at time zone 'Asia/Yangon')::date);
    result:=jsonb_build_object('month',m,'historyFrom',(history_end-interval '3 months')::date,'historyTo',history_end,
      'coverageSince',(select observed_since from supplylink_private.planning_config), 'current',current_rows,
      'plans',coalesce((select jsonb_agg(supplylink_private.plan_json(x) order by version desc) from
        (select * from supplylink_private.stock_plans where branch_id=b.id and month=m order by version desc limit 20) x),'[]'::jsonb),
      'incoming',coalesce((select jsonb_agg(jsonb_build_object('id',tr.id,'reference',tr.reference,'variant',prod.pack,'quantity',tr.quantity,'due',a.due) order by tr.created_at)
        from public.stock_transfers tr join public.products prod on prod.id=tr.product_id left join supplylink_private.planning_arrivals a on a.transfer_id=tr.id
        where tr.destination_branch_id=b.id and tr.status='shipping'),'[]'::jsonb),
      'unmet',coalesce((select jsonb_agg(jsonb_build_object('orderId',u.order_id,'reference',o.reference,'reason',u.reason,
        'units',(select sum((x->>'quantity')::integer) from jsonb_array_elements(u.lines) x)))
        from supplylink_private.backup_unmet u join public.orders o on o.id=u.order_id
        where u.recorded_at>=(history_end::timestamp-interval '3 months') at time zone 'Asia/Yangon' and u.recorded_at<=now()
        and not exists(select 1 from public.delivery_handoffs h where h.order_id=u.order_id and h.status='accepted' and coalesce(h.responded_at,h.created_at)>=u.recorded_at)),'[]'::jsonb));
    return result;
  elsif p_action='generate' then
    if not b.active then raise exception 'Plans cannot be generated for a closed branch.'; end if;
    if m<date_trunc('month',now() at time zone 'Asia/Yangon')::date or m>(date_trunc('month',now() at time zone 'Asia/Yangon')+interval '12 months')::date then raise exception 'Generate a plan for this month or the next twelve months.'; end if;
    overrides:=coalesce(p_payload->'overrides','[]'); edited:='[]';
    if jsonb_typeof(overrides)<>'array' or jsonb_array_length(overrides)>100 then raise exception 'Invalid target overrides.'; end if;
    if (select count(*)<>count(distinct x->>'productId') from jsonb_array_elements(overrides) x) or
      exists(select 1 from jsonb_array_elements(overrides) x where not exists(select 1 from jsonb_array_elements(current_rows) r where r->>'productId'=x->>'productId')) then raise exception 'Duplicate or unknown SKU override.'; end if;
    for row_item in select * from jsonb_array_elements(current_rows) loop
      select x into override_item from jsonb_array_elements(overrides) x where x->>'productId'=row_item->>'productId';
      target:=coalesce((override_item->>'target')::integer,(row_item->>'baseline')::integer);
      move:=coalesce((override_item->>'retailMove')::integer,0);
      if target<0 or target>1000000 or move<0 or move>(row_item->>'retailAvailable')::integer or move>greatest(0,coalesce(target,0)-(row_item->>'carryover')::integer) then raise exception 'Check target and available retail reallocation quantities.'; end if;
      if ((override_item->>'target') is not null or move>0) and length(trim(coalesce(override_item->>'reason','')))<3 then raise exception 'Explain each manual target or retail reallocation.'; end if;
      if length(coalesce(override_item->>'reason',''))>500 then raise exception 'Planning reasons must be at most 500 characters.'; end if;
      edited:=edited||jsonb_build_array(row_item||jsonb_build_object('target',target,'manual',(override_item->>'target') is not null,
        'retailMove',move,'reason',coalesce(override_item->>'reason',''),
        'refill',case when target is null then null else greatest(0,target-(row_item->>'carryover')::integer-move-(row_item->>'incoming')::integer) end));
    end loop;
    select coalesce(max(version),0)+1 into v from supplylink_private.stock_plans where branch_id=b.id and month=m;
    insert into supplylink_private.stock_plans(branch_id,month,version,buffer,min_months,min_orders,inputs,rows,fingerprint,created_by)
      values(b.id,m,v,buffer,min_months,min_orders,current_rows,edited,md5(current_rows::text),actor.id) returning * into p;
    result:=supplylink_private.plan_json(p);
  elsif p_action='approve' then
    if length(reason)<3 or length(reason)>500 then raise exception 'Record an approval reason.'; end if;
    -- Branch then inventory then plan: same lock order as generation, stable across concurrent approvals.
    select b0.* into b from public.branches b0 join supplylink_private.stock_plans p0 on p0.branch_id=b0.id where p0.id=(p_payload->>'planId')::uuid for update of b0;
    if b.id is null or not b.active then raise exception 'Choose an open branch plan.'; end if;
    -- Receipt and arrival confirmation lock the transfer first; use that same order.
    perform id from public.stock_transfers where destination_branch_id=b.id and status='shipping' order by id for update;
    perform id from public.inventory where branch_id=b.id order by product_id for update;
    select * into p from supplylink_private.stock_plans where id=(p_payload->>'planId')::uuid for update;
    if p.status<>'draft' or exists(select 1 from supplylink_private.stock_plans where branch_id=b.id and month=p.month and version>p.version) then raise exception 'Only the latest draft can be approved.'; end if;
    if (now() at time zone 'Asia/Yangon')::date < p.month-1 or (now() at time zone 'Asia/Yangon')::date >= (p.month+interval '1 month')::date then raise exception 'Finalize at month-end or during the target month.'; end if;
    current_rows:=supplylink_private.planning_rows(b.id,p.month,p.buffer,p.min_months,p.min_orders);
    if md5(current_rows::text)<>p.fingerprint then raise exception 'Stock or demand changed. Refresh and generate a new version before approval.'; end if;
    if exists(select 1 from jsonb_array_elements(p.rows) r where r->>'target' is null) then raise exception 'Enter manual targets for SKUs with insufficient history.'; end if;
    if exists(select 1 from supplylink_private.reserve_targets rt join supplylink_private.stock_plans newer on newer.id=rt.plan_id where rt.branch_id=b.id and newer.month>p.month) then raise exception 'A later month is already approved. Review that month instead.'; end if;
    for row_item in select * from jsonb_array_elements(p.rows) loop
      target:=(row_item->>'target')::integer;
      update public.inventory set protected_reserve=least(target,(row_item->>'carryover')::integer+(row_item->>'retailMove')::integer)
        where branch_id=b.id and product_id=(row_item->>'productId')::uuid;
      insert into supplylink_private.reserve_targets(branch_id,product_id,target,plan_id)
        values(b.id,(row_item->>'productId')::uuid,target,p.id)
        on conflict(branch_id,product_id) do update set target=excluded.target,plan_id=excluded.plan_id;
    end loop;
    update supplylink_private.stock_plans set status='superseded' where branch_id=b.id and month=p.month and status='approved';
    update supplylink_private.stock_plans set status='approved',approved_by=actor.id,approved_at=now(),approval_reason=reason where id=p.id returning * into p;
    result:=supplylink_private.plan_json(p);
  elsif p_action='arrival' then
    if length(reason)<3 then raise exception 'Explain the arrival confirmation.'; end if;
    select * into t from public.stock_transfers where id=(p_payload->>'transferId')::uuid and destination_branch_id is not null and status='shipping' for update;
    if not found or (p_payload->>'due')::date<(now() at time zone 'Asia/Yangon')::date then raise exception 'Choose an incoming dispatched transfer and a current or future arrival date.'; end if;
    insert into supplylink_private.planning_arrivals(transfer_id,due,reason,actor_id) values(t.id,(p_payload->>'due')::date,reason,actor.id)
      on conflict(transfer_id) do update set due=excluded.due,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=now();
    result:=jsonb_build_object('message','Arrival confirmed for planning; stock still awaits physical receipt.');
  elsif p_action='unmet' then
    if length(reason)<3 then raise exception 'Explain why no branch can fulfil this backup.'; end if;
    if not exists(select 1 from public.orders where id=(p_payload->>'orderId')::uuid and status='On hold' and payment_verified_at is not null and reserved_at is not null) then raise exception 'Record unmet backup demand for a paid, held order.'; end if;
    if exists(select 1 from public.delivery_handoffs where order_id=(p_payload->>'orderId')::uuid and status='pending') then raise exception 'Resolve the current branch request before recording unmet backup demand.'; end if;
    insert into supplylink_private.backup_unmet(order_id,lines,reason,actor_id)
      select (p_payload->>'orderId')::uuid,jsonb_agg(jsonb_build_object('productId',product_id,'quantity',quantity)),reason,actor.id
      from public.order_lines where order_id=(p_payload->>'orderId')::uuid
      on conflict(order_id) do update set reason=excluded.reason,actor_id=excluded.actor_id,recorded_at=now();
    result:=jsonb_build_object('message','Unfulfilled backup demand recorded once for this order.');
  elsif p_action='claim_explanation' then
    select * into p from supplylink_private.stock_plans where id=(p_payload->>'planId')::uuid for update;
    if not found then raise exception 'Plan not found.'; end if;
    if p.explanation->>'status'='ready' and not coalesce((p_payload->>'regenerate')::boolean,false) then return jsonb_build_object('cached',true,'plan',supplylink_private.plan_json(p)); end if;
    if p.explanation_requested_at>now()-interval '60 seconds' then return jsonb_build_object('cached',true,'plan',supplylink_private.plan_json(p)); end if;
    perform pg_advisory_xact_lock(hashtext('planning_explanation_daily'));
    if (select count(*) from supplylink_private.planning_explanation_attempts where requested_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=50 then raise exception 'Daily explanation request budget reached. Planning remains available.'; end if;
    token:=gen_random_uuid();
    update supplylink_private.stock_plans set explanation='{"status":"pending"}',explanation_token=token,explanation_requested_at=now() where id=p.id returning * into p;
    insert into supplylink_private.planning_explanation_attempts(plan_id) values(p.id);
    return jsonb_build_object('cached',false,'token',token,'plan',supplylink_private.plan_json(p));
  else raise exception 'Unknown planning operation.';
  end if;
  insert into public.workflow_operations(actor_id,operation_key,fingerprint,result) values(actor.id,p_key,fingerprint,result);
  insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'planning.'||p_action,coalesce(p.id,b.id,t.id),jsonb_build_object('reason',reason));
  return result;
end; $$;
revoke all on function supplylink_private.stock_planning(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.stock_planning(text,jsonb,uuid) to authenticated;
create function public.stock_planning(p_action text,p_payload jsonb,p_key uuid default null) returns jsonb language sql security invoker set search_path='' as $$
  select supplylink_private.stock_planning(p_action,p_payload,p_key);
$$;
revoke all on function public.stock_planning(text,jsonb,uuid) from public,anon;
grant execute on function public.stock_planning(text,jsonb,uuid) to authenticated;

-- Only the trusted server may mark an explanation as model-generated.
create function supplylink_private.planning_store_explanation(p_plan uuid,p_actor uuid,p_token uuid,p_explanation jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='hq' and status='active' and not must_change_password) then raise exception 'Active HQ access required.'; end if;
  if p_explanation->>'status' not in ('ready','failed') or length(p_explanation::text)>10000 then raise exception 'Invalid explanation result.'; end if;
  update supplylink_private.stock_plans set explanation=p_explanation,explanation_token=null
    where id=p_plan and explanation_token=p_token;
end; $$;
revoke all on function supplylink_private.planning_store_explanation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function supplylink_private.planning_store_explanation(uuid,uuid,uuid,jsonb) to service_role;
create function public.planning_store_explanation(p_plan uuid,p_actor uuid,p_token uuid,p_explanation jsonb)
returns void language sql security invoker set search_path='' as $$
  select supplylink_private.planning_store_explanation(p_plan,p_actor,p_token,p_explanation);
$$;
revoke all on function public.planning_store_explanation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.planning_store_explanation(uuid,uuid,uuid,jsonb) to service_role;
grant usage on schema supplylink_private to service_role;
commit;
