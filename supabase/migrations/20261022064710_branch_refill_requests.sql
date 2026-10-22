-- One durable request per branch/SKU low-stock episode. No automatic stock transfer.
begin;
create table supplylink_private.branch_refill_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  on_hand integer not null check (on_hand >= 0),
  threshold integer not null default 10 check (threshold = 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table supplylink_private.branch_refill_requests enable row level security;
revoke all on supplylink_private.branch_refill_requests from public,anon,authenticated;
create unique index branch_refill_one_open on supplylink_private.branch_refill_requests(branch_id,product_id) where resolved_at is null;
create index branch_refill_open_recent on supplylink_private.branch_refill_requests(created_at desc,id desc) where resolved_at is null;

create function supplylink_private.capture_branch_refill_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.branch_id is null then return new; end if;
  if new.on_hand < 10
    and exists(select 1 from public.branches where id=new.branch_id and active)
    and exists(select 1 from public.products where id=new.product_id and brand='STT' and active) then
    insert into supplylink_private.branch_refill_requests(branch_id,product_id,on_hand)
      values(new.branch_id,new.product_id,new.on_hand)
      on conflict(branch_id,product_id) where resolved_at is null
      do update set on_hand=excluded.on_hand,updated_at=now();
  else
    update supplylink_private.branch_refill_requests set on_hand=new.on_hand,resolved_at=now(),updated_at=now()
      where branch_id=new.branch_id and product_id=new.product_id and resolved_at is null;
  end if;
  return new;
end; $$;
revoke all on function supplylink_private.capture_branch_refill_request() from public,anon,authenticated;
create trigger branch_refill_request after insert or update of on_hand on public.inventory
  for each row execute function supplylink_private.capture_branch_refill_request();

-- Existing low balances and missing inventory rows (zero stock) need requests too.
insert into supplylink_private.branch_refill_requests(branch_id,product_id,on_hand)
  select b.id,p.id,coalesce(i.on_hand,0) from public.branches b cross join public.products p
  left join public.inventory i on i.branch_id=b.id and i.product_id=p.id
  where b.active and p.brand='STT' and p.active and coalesce(i.on_hand,0)<10;

create function supplylink_private.refill_notifications(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); request_count bigint; request_rows jsonb;
begin
  if actor.role not in ('hq','branch') then
    return jsonb_build_object('refillRequests','[]'::jsonb,'refillRequestCount',0);
  end if;
  select count(*) into request_count from supplylink_private.branch_refill_requests r
    join public.branches b on b.id=r.branch_id and b.active
    join public.products p on p.id=r.product_id and p.active and p.brand='STT'
    where r.resolved_at is null and (p_branch is null or r.branch_id=p_branch)
      and (actor.role='hq' or r.branch_id=actor.branch_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'branchId',r.branch_id,'branchName',b.name,
    'productId',r.product_id,'variant',p.pack,'onHand',r.on_hand,'threshold',r.threshold,'createdAt',r.created_at,
    'incoming',coalesce((select sum(t.quantity) from public.stock_transfers t where t.destination_branch_id=r.branch_id
      and t.product_id=r.product_id and t.status in ('reserved','shipping')),0)) order by r.created_at desc,r.id desc),'[]'::jsonb)
    into request_rows from (
      select req.* from supplylink_private.branch_refill_requests req
      join public.branches br on br.id=req.branch_id and br.active
      join public.products pr on pr.id=req.product_id and pr.active and pr.brand='STT'
      where req.resolved_at is null and (p_branch is null or req.branch_id=p_branch)
        and (actor.role='hq' or req.branch_id=actor.branch_id)
      order by req.created_at desc,req.id desc limit 100
    ) r join public.branches b on b.id=r.branch_id join public.products p on p.id=r.product_id;
  return jsonb_build_object('refillRequests',request_rows,'refillRequestCount',request_count);
end; $$;
revoke all on function supplylink_private.refill_notifications(uuid) from public,anon,authenticated;

-- Extend the existing bounded snapshot without duplicating its order/finance logic.
alter function public.workflow_snapshot(jsonb) rename to workflow_snapshot_pre_refills;
alter function public.workflow_snapshot_pre_refills(jsonb) set schema supplylink_private;
revoke all on function supplylink_private.workflow_snapshot_pre_refills(jsonb) from public,anon,authenticated;
create function supplylink_private.workflow_snapshot_with_refills(p_query jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select supplylink_private.workflow_snapshot_pre_refills(p_query)||supplylink_private.refill_notifications();
$$;
revoke all on function supplylink_private.workflow_snapshot_with_refills(jsonb) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_snapshot_with_refills(jsonb) to authenticated;
create function public.workflow_snapshot(p_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select supplylink_private.workflow_snapshot_with_refills(p_query);
$$;
revoke all on function public.workflow_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.workflow_snapshot(jsonb) to authenticated;

-- Branch detail gets its own request subset, regardless of the global notification limit.
alter function supplylink_private.branch_transfer_history(uuid,integer,integer) rename to branch_transfer_history_pre_refills;
revoke all on function supplylink_private.branch_transfer_history_pre_refills(uuid,integer,integer) from public,anon,authenticated;
create function supplylink_private.branch_transfer_history(p_branch uuid,p_page integer,p_page_size integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select supplylink_private.branch_transfer_history_pre_refills(p_branch,p_page,p_page_size)
    ||supplylink_private.refill_notifications(p_branch);
$$;
revoke all on function supplylink_private.branch_transfer_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function supplylink_private.branch_transfer_history(uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
