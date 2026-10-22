-- Branch movement records show physical stock additions after receipt.
begin;

-- Branches must confirm an existing transfer before stock can be added.
do $$
begin
  if to_regprocedure('public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid)') is not null then
    execute 'revoke execute on function public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid) from authenticated';
  end if;
end; $$;

create or replace function public.branch_stock_movement_history(
  p_branch uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  total_count bigint;
  rows jsonb;
begin
  if actor.role<>'branch' or actor.branch_id is null or actor.branch_id is distinct from p_branch then
    raise exception 'You can only view stock movement records for your own branch.';
  end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (25,50,100) then
    raise exception 'Choose a valid record page.';
  end if;
  if p_branch is not null and not exists(select 1 from public.branches where id=p_branch) then
    raise exception 'Branch not found.';
  end if;

  select count(*) into total_count
  from public.inventory_movements m
  where m.branch_id=p_branch and m.kind in ('transfer_in','physical_in_retail','physical_in_backup');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',page.id,'branchId',page.branch_id,'branchName',page.branch_name,
    'productId',page.product_id,'variant',page.variant,'kind',page.kind,
    'quantity',page.quantity,'reason',page.reason,'actorName',page.actor_name,'createdAt',page.created_at
  ) order by page.created_at desc,page.id desc),'[]'::jsonb) into rows
  from (
    select m.id,m.branch_id,b.name branch_name,m.product_id,p.pack variant,m.kind,m.quantity,m.reason,
      coalesce(profile.name,'Branch staff') actor_name,m.created_at
    from public.inventory_movements m
    join public.branches b on b.id=m.branch_id
    join public.products p on p.id=m.product_id
    left join public.profiles profile on profile.id=m.actor_id
    where m.branch_id=p_branch and m.kind in ('transfer_in','physical_in_retail','physical_in_backup')
    order by m.created_at desc,m.id desc
    offset (p_page-1)*p_page_size limit p_page_size
  ) page;
  return jsonb_build_object('rows',rows,'total',total_count,'page',p_page,'pageSize',p_page_size);
end; $$;

revoke all on function public.branch_stock_movement_history(uuid,integer,integer) from public,anon;
grant execute on function public.branch_stock_movement_history(uuid,integer,integer) to authenticated;
comment on function public.branch_stock_movement_history(uuid,integer,integer) is
  'Branch scoped history of physical stock additions after receipt.';

notify pgrst, 'reload schema';

commit;
