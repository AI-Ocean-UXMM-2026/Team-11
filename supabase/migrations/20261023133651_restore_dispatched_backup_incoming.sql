-- Preserve longyi stock units while restoring the dispatched-until-received rule.
-- Arrival dates belong to monthly projections, not the current backup refill gap.
begin;

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
 left join lateral(select count(*)::integer open_count,
     coalesce(sum(t.quantity) filter(where t.status='shipping'),0)::integer quantity
   from public.stock_transfers t
   where t.destination_branch_id=b.id and t.product_id=p.id and t.purpose='backup' and t.status in ('reserved','shipping')) n on true
 where b.active and p.active and p.brand='STT';
$$;

revoke all on function supplylink_private.planning_catalog() from public,anon,authenticated;
comment on function supplylink_private.planning_catalog() is
  'Planning counts dispatched backup transfers as incoming until branch receipt.';

commit;
