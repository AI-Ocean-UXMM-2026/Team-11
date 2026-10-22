-- Opt-in fixture for a dedicated empty TEST database only.
-- Apply after all files in migrations/. Do not run against production.
begin;

do $$
begin
  if to_regclass('supplylink_private.planning_history_samples') is null
    or to_regclass('supplylink_private.planning_history_sample_runs') is null then
    raise exception 'Apply the Stock Planning and three-month history migrations first.';
  end if;
  if not exists (
    select 1 from supplylink_private.planning_history_sample_runs
    where batch_key='three_month_backup_history_v1'
  ) then
    raise exception 'Apply the three-month planning history migration first.';
  end if;
  if exists(select 1 from public.branches) then
    raise exception 'Test fixture requires an empty branch list.';
  end if;
  if (select count(*) from public.profiles)>1
    or exists(select 1 from public.profiles where role<>'hq' or status<>'active') then
    raise exception 'Test fixture supports no profiles or one active HQ profile only.';
  end if;
end;
$$;

insert into public.branches(name,address,manager_name,latitude,longitude)
values
  ('TEST Yangon Central','TEST · 12 Sule Pagoda Road, Yangon','Test Manager 01',16.7798,96.1568),
  ('TEST Yangon East','TEST · 45 Lower Pazundaung Road, Yangon','Test Manager 02',16.7838,96.1834),
  ('TEST Yangon West','TEST · 88 Pyay Road, Yangon','Test Manager 03',16.8152,96.1331),
  ('TEST Yangon North','TEST · 32 Insein Road, Yangon','Test Manager 04',16.8581,96.1307);

-- Start with 300 pieces of each style at HQ and 60 at each branch.
insert into public.inventory(branch_id,product_id,on_hand,protected_reserve,allocated)
select null,p.id,300,0,0
from public.products p
where p.brand='STT' and p.category='Longyi' and p.active and p.sku like 'LY-%'
on conflict(branch_id,product_id) do update
set on_hand=excluded.on_hand,protected_reserve=0,allocated=0;

insert into public.inventory(branch_id,product_id,on_hand,protected_reserve,allocated)
select b.id,p.id,60,0,0
from public.branches b cross join public.products p
where b.name like 'TEST Yangon %'
  and p.brand='STT' and p.category='Longyi' and p.active and p.sku like 'LY-%'
on conflict(branch_id,product_id) do nothing;

-- Six synthetic backup orders and three refill receipts per branch/SKU.
-- These are private planning aggregates, not real sales, orders or movements.
insert into supplylink_private.planning_history_samples(
  branch_id,product_id,month,batch_key,takeover_orders,takeover_units,
  refill_receipts,refill_lead_days_total
)
select b.id,p.id,m.month,'three_month_backup_history_v1',2,
  10 + (extract(month from m.month)::integer % 4) * 3
    + get_byte(decode(substr(md5(b.id::text||p.id::text),1,2),'hex'),0) % 8,
  1,2 + extract(month from m.month)::integer % 3
from public.branches b
cross join public.products p
cross join supplylink_private.planning_history_sample_runs r
cross join lateral generate_series(
  r.history_from::timestamp,
  r.history_to::timestamp - interval '1 month',
  interval '1 month'
) as m(month)
where b.name like 'TEST Yangon %'
  and p.brand='STT' and p.category='Longyi' and p.active and p.sku like 'LY-%'
  and r.batch_key='three_month_backup_history_v1';

insert into public.audit_events(action,details)
values('test_workspace.seeded',jsonb_build_object(
  'source','synthetic test fixture',
  'branches',4,
  'products',(select count(*) from public.products where brand='STT' and category='Longyi' and active and sku like 'LY-%'),
  'historyMonths',3,
  'planningBatch','three_month_backup_history_v1'
));

commit;
