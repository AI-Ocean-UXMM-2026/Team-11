-- Replace the active STT demo catalog with the user supplied longyi catalog.
-- Existing products, inventory, orders, sales and movement history remain intact.
create table if not exists supplylink_private.catalog_replacement_backups (
  batch_key text primary key,
  captured_at timestamptz not null default now(),
  products jsonb not null,
  inventory jsonb not null
);
alter table supplylink_private.catalog_replacement_backups enable row level security;
revoke all on table supplylink_private.catalog_replacement_backups from public, anon, authenticated;

insert into supplylink_private.catalog_replacement_backups(batch_key,products,inventory)
select 'longyi_catalog_20261023',
  coalesce((select jsonb_agg(to_jsonb(p) order by p.sku) from public.products p where p.brand='STT'), '[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(i) order by i.product_id, i.branch_id nulls first) from public.inventory i join public.products p on p.id=i.product_id where p.brand='STT'), '[]'::jsonb)
on conflict (batch_key) do nothing;

alter table public.products add column if not exists image_path text;

create temporary table incoming_longyi_catalog (
  sku text, name text, category text, variant text, unit text,
  price numeric, minimum integer, hq_stock integer, branch_stock integer, image_path text
);
alter table incoming_longyi_catalog enable row level security;
insert into incoming_longyi_catalog values
  ('LY-1-2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 1.2', 'piece', 45000, 2, 0, 0, '/products/catalog-import/1.2.webp'),
  ('LY-1-3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 1.3', 'piece', 45000, 2, 0, 0, '/products/catalog-import/1.3.webp'),
  ('LY-1-4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 1.4', 'piece', 45000, 2, 0, 0, '/products/catalog-import/1.4.webp'),
  ('LY-1-5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 1.5', 'piece', 45000, 2, 0, 0, '/products/catalog-import/1.5.webp'),
  ('LY-1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 1', 'piece', 45000, 2, 0, 0, '/products/catalog-import/1.webp'),
  ('LY-2-1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 2.1', 'piece', 45000, 2, 0, 0, '/products/catalog-import/2.1.webp'),
  ('LY-2-2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 2.2', 'piece', 45000, 2, 0, 0, '/products/catalog-import/2.2.webp'),
  ('LY-2-3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 2.3', 'piece', 45000, 2, 0, 0, '/products/catalog-import/2.3.webp'),
  ('LY-2-4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 2.4', 'piece', 45000, 2, 0, 0, '/products/catalog-import/2.4.webp'),
  ('LY-2-5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 2.5', 'piece', 45000, 2, 0, 0, '/products/catalog-import/2.5.webp'),
  ('LY-3-1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 3.1', 'piece', 45000, 2, 0, 0, '/products/catalog-import/3.1.webp'),
  ('LY-3-2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 3.2', 'piece', 45000, 2, 0, 0, '/products/catalog-import/3.2.webp'),
  ('LY-3-3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 3.3', 'piece', 45000, 2, 0, 0, '/products/catalog-import/3.3.webp'),
  ('LY-3-4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 3.4', 'piece', 45000, 2, 0, 0, '/products/catalog-import/3.4.webp'),
  ('LY-3-5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 3.5', 'piece', 45000, 2, 0, 0, '/products/catalog-import/3.5.webp'),
  ('LY-4-1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 4.1', 'piece', 45000, 2, 0, 0, '/products/catalog-import/4.1.webp'),
  ('LY-4-2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 4.2', 'piece', 45000, 2, 0, 0, '/products/catalog-import/4.2.webp'),
  ('LY-4-3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 4.3', 'piece', 45000, 2, 0, 0, '/products/catalog-import/4.3.webp'),
  ('LY-4-4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 4.4', 'piece', 45000, 2, 0, 0, '/products/catalog-import/4.4.webp'),
  ('LY-4-5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style 4.5', 'piece', 45000, 2, 0, 0, '/products/catalog-import/4.5.webp'),
  ('LY-P-2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style p.2', 'piece', 80000, 2, 0, 0, '/products/catalog-import/p.2.webp'),
  ('LY-P-3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style p.3', 'piece', 80000, 2, 0, 0, '/products/catalog-import/p.3.webp'),
  ('LY-P-4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style p.4', 'piece', 80000, 2, 0, 0, '/products/catalog-import/p.4.webp'),
  ('LY-P-5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style p.5', 'piece', 80000, 2, 0, 0, '/products/catalog-import/p.5.webp'),
  ('LY-P1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style P1', 'piece', 80000, 2, 0, 0, '/products/catalog-import/P1.webp'),
  ('LY-P2', 'Premium Fine Fabric Longyi', 'Longyi', 'Style P2', 'piece', 80000, 2, 0, 0, '/products/catalog-import/P2.webp'),
  ('LY-P3', 'Premium Fine Fabric Longyi', 'Longyi', 'Style P3', 'piece', 80000, 2, 0, 0, '/products/catalog-import/P3.webp'),
  ('LY-P4', 'Premium Fine Fabric Longyi', 'Longyi', 'Style P4', 'piece', 80000, 2, 0, 0, '/products/catalog-import/P4.webp'),
  ('LY-P5', 'Premium Fine Fabric Longyi', 'Longyi', 'Style P5', 'piece', 80000, 2, 0, 0, '/products/catalog-import/P5.webp'),
  ('LY-P-1', 'Premium Fine Fabric Longyi', 'Longyi', 'Style p.1', 'piece', 80000, 2, 0, 0, '/products/catalog-import/p.1.webp')
;

update public.products set active=false where brand='STT' and active;

insert into public.products(sku,name,brand,category,size,color,pack,base_units_per_pack,wholesale_price,minimum_packs,available_packs,image_path,active)
select c.sku,c.name,'STT',c.category,c.variant,c.variant,
  c.variant || ' · 1 ' || c.unit,1,c.price,c.minimum,c.hq_stock,c.image_path,true
from incoming_longyi_catalog c
on conflict (sku) do nothing;

insert into public.inventory(branch_id,product_id,on_hand)
select null,p.id,c.hq_stock
from incoming_longyi_catalog c join public.products p on p.sku=c.sku
on conflict (branch_id,product_id) do nothing;

insert into public.inventory(branch_id,product_id,on_hand)
select b.id,p.id,c.branch_stock
from incoming_longyi_catalog c join public.products p on p.sku=c.sku
cross join public.branches b where b.active
on conflict (branch_id,product_id) do nothing;
drop table incoming_longyi_catalog;

create or replace function supplylink_private.planning_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('branchId',b.id,'branchName',b.name,'productId',p.id,'productName',p.name,'variant',p.pack,
   'unit',coalesce(rt.stock_unit,case when p.category='Longyi' then 'piece' else 'pairs' end),
   'retail',greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)),
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

create or replace function supplylink_private.refill_notifications(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); request_count bigint; request_rows jsonb;
begin
  if actor.role not in ('hq','branch') then return jsonb_build_object('refillRequests','[]'::jsonb,'refillRequestCount',0); end if;
  select count(*) into request_count from supplylink_private.branch_refill_requests r
    join public.branches b on b.id=r.branch_id and b.active join public.products p on p.id=r.product_id and p.active and p.brand='STT'
    where r.resolved_at is null and (p_branch is null or r.branch_id=p_branch) and (actor.role='hq' or r.branch_id=actor.branch_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'branchId',r.branch_id,'branchName',b.name,'productId',r.product_id,
    'variant',p.pack,'pool',r.pool,'onHand',r.on_hand,'threshold',r.threshold,
    'unit',coalesce(rt.stock_unit,case when p.category='Longyi' then 'piece' else 'pairs' end),
    'createdAt',r.created_at,
    'incoming',coalesce((select sum(t.quantity) from public.stock_transfers t where t.destination_branch_id=r.branch_id and t.product_id=r.product_id
      and t.status in ('reserved','shipping') and (r.pool='on_hand' or t.purpose='backup')),0)) order by r.created_at desc,r.id desc),'[]'::jsonb)
    into request_rows from (select req.* from supplylink_private.branch_refill_requests req
      join public.branches br on br.id=req.branch_id and br.active join public.products pr on pr.id=req.product_id and pr.active and pr.brand='STT'
      where req.resolved_at is null and (p_branch is null or req.branch_id=p_branch) and (actor.role='hq' or req.branch_id=actor.branch_id)
      order by req.created_at desc,req.id desc limit 100) r
      join public.branches b on b.id=r.branch_id join public.products p on p.id=r.product_id
      left join supplylink_private.reserve_targets rt on rt.branch_id=r.branch_id and rt.product_id=r.product_id;
  return jsonb_build_object('refillRequests',request_rows,'refillRequestCount',request_count);
end; $$;
revoke all on function supplylink_private.refill_notifications(uuid) from public,anon,authenticated;
grant execute on function supplylink_private.refill_notifications(uuid) to authenticated;

-- Expose the catalog SKU while preserving the existing bounded snapshot behavior.
create or replace function supplylink_private.workflow_snapshot_with_refills(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb;
  product_rows jsonb;
  actor public.profiles:=supplylink_private.workspace_actor();
  branches jsonb;
begin
  result:=supplylink_private.workflow_snapshot_pre_stock_pools(p_query);
  select coalesce(jsonb_agg(r.value||case when actor.role in ('hq','branch') then jsonb_build_object(
      'retailStock',(select coalesce(sum(i.on_hand-i.allocated-i.protected_reserve),0) from public.inventory i where i.branch_id=(r.value->>'id')::uuid),
      'backupStock',(select coalesce(sum(i.protected_reserve),0) from public.inventory i where i.branch_id=(r.value->>'id')::uuid),
      'inventory',coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'variant',p.pack,'onHand',coalesce(i.on_hand,0),
        'allocated',coalesce(i.allocated,0),'protected',coalesce(i.protected_reserve,0),'backupTarget',rt.target,
        'backupAllocated',coalesce((select sum(a.quantity) from supplylink_private.branch_backup_allocations a where a.branch_id=i.branch_id and a.product_id=p.id),0)) order by p.color,p.size)
        from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=(r.value->>'id')::uuid
        left join supplylink_private.reserve_targets rt on rt.branch_id=(r.value->>'id')::uuid and rt.product_id=p.id
        where p.brand='STT' and p.active),'[]'::jsonb)) else '{}'::jsonb end order by r.ordinality),'[]'::jsonb) into branches
    from jsonb_array_elements(result->'branches') with ordinality r(value,ordinality);
  result:=jsonb_set(result,'{branches}',branches);
  result:=jsonb_set(result,'{transfers}',supplylink_private.transfers_with_purpose(result->'transfers'));
  select coalesce(jsonb_agg(r.value||jsonb_build_object('sku',p.sku,'imagePath',p.image_path) order by p.name,p.color,p.size),'[]'::jsonb)
    into product_rows
    from jsonb_array_elements(coalesce(result->'products','[]'::jsonb)) with ordinality r(value,ordinality)
    join public.products p on p.id=(r.value->>'id')::uuid;
  return jsonb_set(result,'{products}',product_rows);
end; $$;
revoke all on function supplylink_private.workflow_snapshot_with_refills(jsonb) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_snapshot_with_refills(jsonb) to authenticated;

