-- Owner-requested synthetic planning evidence. No labels are added to the UI.
-- Apply AFTER 20261022090646_stock_planning_function_validation.sql.
-- This does not create orders, sales, transfers or inventory movements, and does
-- not backdate real branch/product creation or genuine observation coverage.
-- Evidence is private, explicitly synthetic, and used ONLY by Stock Planning.
begin;

do $$ begin
  if to_regprocedure('supplylink_private.planning_rows_pre_workspace(uuid,date,integer,integer,integer)') is null
    or to_regprocedure('supplylink_private.backup_recommendation(uuid,uuid)') is null then
    raise exception 'Apply the Stock Planning migrations through 20261022090646 before this history migration.';
  end if;
end; $$;

create table if not exists supplylink_private.planning_history_sample_runs (
  batch_key text primary key,
  source text not null default 'synthetic' check(source='synthetic'),
  history_from date not null,
  history_to date not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check(extract(day from history_from)=1 and extract(day from history_to)=1),
  check(history_to=(history_from+interval '3 months')::date)
);
create table if not exists supplylink_private.planning_history_samples (
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  month date not null check(extract(day from month)=1),
  batch_key text not null references supplylink_private.planning_history_sample_runs(batch_key),
  takeover_orders integer not null check(takeover_orders>0),
  takeover_units integer not null check(takeover_units>=takeover_orders),
  refill_receipts integer not null check(refill_receipts>0),
  refill_lead_days_total numeric not null check(refill_lead_days_total>=0),
  primary key(branch_id,product_id,month)
);
comment on table supplylink_private.planning_history_samples is
  'Synthetic monthly emergency-wholesale aggregates, not genuine transactions. Provenance is database-only; never included in sales, stock balances, or delivery history.';
comment on table supplylink_private.planning_history_sample_runs is
  'Owner-requested synthetic history batches. Set enabled=false to stop using a batch in new planning calculations. Never automatically extended into later months.';
alter table supplylink_private.planning_history_sample_runs enable row level security;
alter table supplylink_private.planning_history_samples enable row level security;
revoke all on supplylink_private.planning_history_sample_runs,supplylink_private.planning_history_samples from public,anon,authenticated;
grant usage on schema supplylink_private to service_role;
grant select,insert,update,delete on supplylink_private.planning_history_sample_runs,supplylink_private.planning_history_samples to service_role;

-- Retain the existing private function's security boundary. Only checked HQ
-- planning RPCs expose its aggregate results; raw samples remain inaccessible.
create or replace function supplylink_private.backup_recommendation(p_branch uuid,p_product uuid) returns jsonb
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

  -- Synthetic coverage applies to its explicit month/pair only. It never
  -- changes the real observation timeline, or certifies an unseeded month.
  select count(*)::integer into months
    from generate_series(period_start::timestamp,period_end::timestamp-interval '1 month',interval '1 month') m
    where m at time zone 'Asia/Yangon'>=observed or exists(
      select 1 from supplylink_private.planning_history_samples s
      join supplylink_private.planning_history_sample_runs r on r.batch_key=s.batch_key and r.enabled
      where s.branch_id=p_branch and s.product_id=p_product and s.month=m::date
        and s.month>=r.history_from and s.month<r.history_to);

  with canonical as (
    select distinct on(h.order_id) h.order_id,h.branch_id,h.created_at from public.delivery_handoffs h
    join public.orders o on o.id=h.order_id and o.status<>'Cancelled'
    where h.status='accepted' order by h.order_id,h.responded_at desc nulls last,h.created_at desc,h.id
  ), demand as (
    select date_trunc('month',h.created_at at time zone 'Asia/Yangon')::date as month,
      count(distinct h.order_id)::integer orders,sum(l.quantity)::integer units
    from canonical h join public.order_lines l on l.order_id=h.order_id
    where h.branch_id=p_branch and l.product_id=p_product
      and h.created_at>=period_start::timestamp at time zone 'Asia/Yangon'
      and h.created_at<period_end::timestamp at time zone 'Asia/Yangon'
    group by 1
  ), samples as (
    select s.* from supplylink_private.planning_history_samples s
    join supplylink_private.planning_history_sample_runs r on r.batch_key=s.batch_key and r.enabled
    where s.branch_id=p_branch and s.product_id=p_product
      and s.month>=period_start and s.month<period_end
      and s.month>=r.history_from and s.month<r.history_to
  ), monthly as (
    select m,coalesce(d.orders,0)+coalesce(s.takeover_orders,0) orders,
      (coalesce(d.units,0)+coalesce(s.takeover_units,0))::numeric quantity
    from generate_series(period_start::timestamp,period_end::timestamp-interval '1 month',interval '1 month') m
    left join demand d on d.month=m::date left join samples s on s.month=m::date
  ) select sum(monthly.orders)::integer,sum(quantity)::integer,avg(quantity),stddev_pop(quantity)
    into orders,units,mean_units,variation from monthly;

  with evidence as (
    select 1 receipts,extract(epoch from(received_at-dispatched_at))/86400 lead_total
    from public.stock_transfers where destination_branch_id=p_branch and product_id=p_product and purpose='backup'
      and status='received' and received_at>=dispatched_at
      and received_at>=period_start::timestamp at time zone 'Asia/Yangon'
      and received_at<period_end::timestamp at time zone 'Asia/Yangon'
    union all
    select s.refill_receipts,s.refill_lead_days_total from supplylink_private.planning_history_samples s
    join supplylink_private.planning_history_sample_runs r on r.batch_key=s.batch_key and r.enabled
    where s.branch_id=p_branch and s.product_id=p_product
      and s.month>=period_start and s.month<period_end
      and s.month>=r.history_from and s.month<r.history_to
  ) select coalesce(sum(e.receipts),0)::integer,round(sum(e.lead_total)/nullif(sum(e.receipts),0),2)
    into receipts,lead_days from evidence e;
  eligible:=months>=3 and orders>=5 and receipts>=1;
  return jsonb_build_object('eligible',eligible,'quantity',case when eligible then ceil(mean_units+variation+units::numeric/90*lead_days)::integer else null end,
    'from',period_start,'to',period_end,'completeMonths',months,'orders',orders,'units',units,
    'monthlyAverage',round(mean_units,2),'monthlyVariation',round(variation,2),'leadDays',lead_days,'receipts',receipts,
    'minimumMonths',3,'minimumOrders',5,'minimumReceipts',1);
end; $$;
revoke all on function supplylink_private.backup_recommendation(uuid,uuid) from public,anon,authenticated;

-- Keep the monthly versions editor and AI explanation inputs consistent with
-- the drawer. Physical stock, retail demand and incoming transfers stay real.
create or replace function supplylink_private.planning_rows(p_branch uuid,p_month date,p_buffer integer,p_min_months integer,p_min_orders integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r.value||
    case when exists(
      select 1 from supplylink_private.planning_history_samples s
      join supplylink_private.planning_history_sample_runs b on b.batch_key=s.batch_key and b.enabled
      where s.branch_id=p_branch and s.product_id=(r.value->>'productId')::uuid
        and s.month>=(rec.value->>'from')::date and s.month<(rec.value->>'to')::date
        and s.month>=b.history_from and s.month<b.history_to)
    then jsonb_build_object('backupUnits',rec.value->'units','backupOrders',rec.value->'orders',
      'completeMonths',rec.value->'completeMonths','refillLeadDays',rec.value->'leadDays')
    else '{}'::jsonb end||jsonb_build_object('baseline',case when (rec.value->>'eligible')::boolean
      then ceil((rec.value->>'quantity')::numeric*(100+p_buffer)/100)::integer else null end)
    order by r.ordinality),'[]'::jsonb)
  from jsonb_array_elements(supplylink_private.planning_rows_pre_workspace(p_branch,p_month,p_buffer,p_min_months,p_min_orders)) with ordinality r(value,ordinality)
  cross join lateral(select supplylink_private.backup_recommendation(p_branch,(r.value->>'productId')::uuid) value) rec;
$$;
revoke all on function supplylink_private.planning_rows(uuid,date,integer,integer,integer) from public,anon,authenticated;

-- Freeze the window on first execution. Rerunning later does NOT fabricate a
-- fresh rolling month, re-enable a disabled batch, or duplicate existing rows.
insert into supplylink_private.planning_history_sample_runs(batch_key,history_from,history_to)
  values('three_month_backup_history_v1',
    (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months')::date,
    date_trunc('month',now() at time zone 'Asia/Yangon')::date)
  on conflict(batch_key) do nothing;

with inserted as (
  insert into supplylink_private.planning_history_samples(branch_id,product_id,month,batch_key,
    takeover_orders,takeover_units,refill_receipts,refill_lead_days_total)
  select b.id,p.id,m::date,r.batch_key,2,
    -- Distinct but reproducible monthly demand for each branch/SKU. Two
    -- takeover orders and one completed refill per month => six / three total.
    16+extract(month from m)::integer%4*3+
      get_byte(decode(substr(md5(b.id::text||p.id::text),1,2),'hex'),0)%8,
    1,2+extract(month from m)::integer%3
  from public.branches b cross join public.products p
  cross join supplylink_private.planning_history_sample_runs r
  cross join lateral generate_series(r.history_from::timestamp,r.history_to::timestamp-interval '1 month',interval '1 month') m
  where r.batch_key='three_month_backup_history_v1' and b.active and p.active and p.brand='STT'
  on conflict(branch_id,product_id,month) do nothing returning branch_id,product_id
)
insert into public.audit_events(action,details)
  select 'planning.synthetic_history_seeded',jsonb_build_object(
    'source','synthetic','batchKey','three_month_backup_history_v1','monthlyRows',count(*),
    'historyFrom',(select history_from from supplylink_private.planning_history_sample_runs where batch_key='three_month_backup_history_v1'),
    'historyToExclusive',(select history_to from supplylink_private.planning_history_sample_runs where batch_key='three_month_backup_history_v1'))
  from inserted having count(*)>0;

commit;
