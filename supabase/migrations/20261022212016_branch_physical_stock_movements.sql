-- Branch accounts record and review physical stock movements at their own branch.
begin;

create or replace function public.record_branch_stock_movement(
  p_branch uuid,
  p_product uuid,
  p_direction text,
  p_pool text,
  p_quantity integer,
  p_reason text,
  p_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  inv public.inventory;
  cached public.workflow_operations;
  fingerprint text;
  reason text:=trim(coalesce(p_reason,''));
  movement_kind text;
  backup_allocated integer:=0;
  result jsonb;
begin
  if actor.role<>'branch' or actor.branch_id is null or actor.branch_id is distinct from p_branch then raise exception 'You can only record stock movements for your own branch.'; end if;
  if p_key is null or p_branch is null or p_product is null or p_direction is null or p_pool is null
    or p_direction not in ('in','out') or p_pool not in ('retail','backup')
    or p_quantity is null or p_quantity not between 1 and 1000000
    or length(reason) not between 3 and 500 then
    raise exception 'Choose a movement, stock pool, whole-pair quantity and reason.';
  end if;
  if not exists(select 1 from public.branches where id=p_branch and active) then raise exception 'Choose an active branch.'; end if;
  if not exists(select 1 from public.products where id=p_product and brand='STT' and active) then raise exception 'Choose an active STT shoe variant.'; end if;

  fingerprint:=md5('branch_stock_movement'||jsonb_build_object('branchId',p_branch,'productId',p_product,'direction',p_direction,'pool',p_pool,'quantity',p_quantity,'reason',reason)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;

  insert into public.inventory(branch_id,product_id) values(p_branch,p_product) on conflict do nothing;
  select * into inv from public.inventory where branch_id=p_branch and product_id=p_product for update;
  if p_pool='backup' then
    select coalesce(sum(quantity),0)::integer into backup_allocated from supplylink_private.branch_backup_allocations where branch_id=p_branch and product_id=p_product;
  end if;
  if p_direction='out' then
    if p_pool='backup' and p_quantity>inv.protected_reserve-backup_allocated then
      raise exception 'That quantity exceeds uncommitted wholesale backup stock.';
    elsif p_pool='retail' and p_quantity>inv.on_hand-inv.allocated-inv.protected_reserve then
      raise exception 'That quantity exceeds available retail stock.';
    end if;
  elsif inv.on_hand+p_quantity>1000000 or (p_pool='backup' and inv.protected_reserve+p_quantity>1000000) then
    raise exception 'The movement would exceed the stock limit.';
  end if;

  if p_direction='in' then
    update public.inventory set on_hand=on_hand+p_quantity,
      protected_reserve=protected_reserve+case when p_pool='backup' then p_quantity else 0 end
      where id=inv.id;
    movement_kind:='physical_in_'||p_pool;
  else
    update public.inventory set on_hand=on_hand-p_quantity,
      protected_reserve=protected_reserve-case when p_pool='backup' then p_quantity else 0 end
      where id=inv.id;
    movement_kind:='physical_out_'||p_pool;
  end if;
  insert into public.inventory_movements(product_id,branch_id,actor_id,kind,quantity,reason)
    values(p_product,p_branch,actor.id,movement_kind,case when p_direction='in' then p_quantity else -p_quantity end,reason);
  result:=jsonb_build_object('message','Physical stock movement recorded.');
  insert into public.workflow_operations(actor_id,operation_key,fingerprint,result) values(actor.id,p_key,fingerprint,result);
  return result;
end; $$;
revoke all on function public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid) from public,anon;
grant execute on function public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid) to authenticated;
comment on function public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid) is 'Branch scoped physical stock movement recording.';

create or replace function public.branch_stock_movement_history(p_branch uuid default null,p_page integer default 1,p_page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  total_count bigint;
  rows jsonb;
begin
  if actor.role<>'branch' or actor.branch_id is null or actor.branch_id is distinct from p_branch then raise exception 'You can only view stock movement records for your own branch.'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (25,50,100) then raise exception 'Choose a valid record page.'; end if;
  if p_branch is not null and not exists(select 1 from public.branches where id=p_branch) then raise exception 'Branch not found.'; end if;
  select count(*) into total_count from public.inventory_movements m where m.branch_id is not null and (p_branch is null or m.branch_id=p_branch);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',page.id,'branchId',page.branch_id,'branchName',page.branch_name,
    'productId',page.product_id,'variant',page.variant,'kind',page.kind,
    'quantity',page.quantity,'reason',page.reason,'actorName',page.actor_name,'createdAt',page.created_at
  ) order by page.created_at desc,page.id desc),'[]'::jsonb) into rows
  from (
    select m.id,m.branch_id,b.name branch_name,m.product_id,p.pack variant,m.kind,m.quantity,m.reason,coalesce(profile.name,'Branch staff') actor_name,m.created_at
    from public.inventory_movements m
    join public.branches b on b.id=m.branch_id
    join public.products p on p.id=m.product_id
    left join public.profiles profile on profile.id=m.actor_id
    where m.branch_id is not null and (p_branch is null or m.branch_id=p_branch)
    order by m.created_at desc,m.id desc offset (p_page-1)*p_page_size limit p_page_size
  ) page;
  return jsonb_build_object('rows',rows,'total',total_count,'page',p_page,'pageSize',p_page_size);
end; $$;
revoke all on function public.branch_stock_movement_history(uuid,integer,integer) from public,anon;
grant execute on function public.branch_stock_movement_history(uuid,integer,integer) to authenticated;
comment on function public.branch_stock_movement_history(uuid,integer,integer) is 'Branch scoped physical stock movement history.';

commit;
