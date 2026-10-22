-- Retail shop stock and HQ emergency wholesale reserves are independent pools.
begin;
alter table public.stock_transfers add column purpose text not null default 'retail' check(purpose in ('retail','backup'));
alter table supplylink_private.reserve_targets alter column plan_id drop not null;
create table supplylink_private.branch_backup_allocations (
  order_id uuid not null references public.orders(id), product_id uuid not null references public.products(id),
  branch_id uuid not null references public.branches(id), quantity integer not null check(quantity>0),
  primary key(order_id,product_id)
);
alter table supplylink_private.branch_backup_allocations enable row level security;
revoke all on supplylink_private.branch_backup_allocations from public,anon,authenticated;
-- Preserve the pool of already committed, undispatched branch wholesale orders.
insert into supplylink_private.branch_backup_allocations(order_id,branch_id,product_id,quantity)
  select o.id,o.source_branch_id,l.product_id,l.quantity from public.orders o join public.order_lines l on l.order_id=o.id
  join public.inventory i on i.branch_id=o.source_branch_id and i.product_id=l.product_id and i.allocated>=l.quantity
  where o.source_branch_id is not null and o.dispatched_at is null and o.reserved_at is not null
    and o.status in ('Confirmed','Preparing','On hold');

alter function public.workflow_execute(text,jsonb,uuid) rename to workflow_execute_pre_pools;
alter function public.workflow_execute_pre_pools(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_pre_pools(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function supplylink_private.workflow_with_planning(text,jsonb,uuid) from public,anon,authenticated;
create function supplylink_private.workflow_with_stock_pools(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); cached public.workflow_operations;
  result jsonb; fingerprint text; inv public.inventory; tr public.stock_transfers; o public.orders; h public.delivery_handoffs;
  v_branch uuid; v_sku uuid; v_target integer; move integer; qty integer; v_purpose text; old_source uuid; reason text;
begin
  if p_key is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>20000 then raise exception 'Operation, payload and retry key are required.'; end if;
  fingerprint:=md5(p_action||p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;
  if actor.branch_id is not null then perform id from public.branches where id=actor.branch_id for share; end if;
  if p_action='backup_configure' then
    if actor.role<>'hq' then raise exception 'Only HQ can configure wholesale backup stock.'; end if;
    reason:=trim(coalesce(p_payload->>'reason','')); v_target:=(p_payload->>'target')::integer; move:=coalesce((p_payload->>'retailMove')::integer,0);
    if v_target is null or v_target not between 0 and 1000000 or move not between 0 and 1000000 or length(reason) not between 3 and 500 then raise exception 'Enter a valid backup target, movement quantity and reason.'; end if;
    v_branch:=(p_payload->>'branchId')::uuid; v_sku:=(p_payload->>'productId')::uuid;
    perform id from public.branches where id=v_branch and active for update;
    if not found or not exists(select 1 from public.products where id=v_sku and brand='STT' and active) then raise exception 'Choose an active branch and STT variant.'; end if;
    insert into public.inventory(branch_id,product_id) values(v_branch,v_sku) on conflict do nothing;
    select * into inv from public.inventory where inventory.branch_id=v_branch and product_id=v_sku for update;
    if move>inv.on_hand-inv.allocated-inv.protected_reserve or move>greatest(0,v_target-inv.protected_reserve) then raise exception 'The explicit retail movement exceeds available pairs or the backup target.'; end if;
    update public.inventory set protected_reserve=least(v_target,inv.protected_reserve+move) where id=inv.id;
    insert into supplylink_private.reserve_targets(branch_id,product_id,target,plan_id) values(v_branch,v_sku,v_target,null)
      on conflict(branch_id,product_id) do update set target=excluded.target,plan_id=null;
    result:=jsonb_build_object('message','Backup target saved. Only the explicitly approved retail movement was applied; arrange any remaining backup refill separately.');
    insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'backup_configure',v_branch,p_payload);
    insert into public.workflow_operations(actor_id,operation_key,fingerprint,result) values(actor.id,p_key,fingerprint,result);
    return result;
  end if;
  if p_action='transfer_create' then
    v_purpose:=coalesce(p_payload->>'purpose','retail');
    if v_purpose not in ('retail','backup') then raise exception 'Choose retail or wholesale backup stock.'; end if;
    if actor.role<>'hq' then raise exception 'Only HQ can authorize stock transfers.'; end if;
    v_branch:=coalesce(nullif(p_payload->>'sourceBranchId','')::uuid,nullif(p_payload->>'destinationBranchId','')::uuid);
    perform id from public.branches where id=v_branch and active for share;
    if nullif(p_payload->>'sourceBranchId','') is not null then
      qty:=(p_payload->>'quantity')::integer;
      if qty is null or qty not between 1 and 1000000 then raise exception 'Enter whole pairs to transfer.'; end if;
      select * into inv from public.inventory where inventory.branch_id=v_branch and product_id=(p_payload->>'productId')::uuid for update;
      if inv.id is null or (v_purpose='retail' and qty>inv.on_hand-inv.allocated-inv.protected_reserve)
        or (v_purpose='backup' and qty>inv.protected_reserve) then raise exception 'Not enough available stock in the selected pool.'; end if;
      if v_purpose='backup' then update public.inventory set protected_reserve=protected_reserve-qty where id=inv.id; end if;
    end if;
  elsif p_action in ('transfer_receive','transfer_cancel') then
    select * into tr from public.stock_transfers where id=(p_payload->>'transferId')::uuid for update;
  elsif p_action in ('handoff_accept','cancel','dispatch') then
    select * into o from public.orders where id=(p_payload->>'orderId')::uuid for update;
    if p_action='handoff_accept' then
      select * into h from public.delivery_handoffs where id=(p_payload->>'handoffId')::uuid and order_id=o.id and status='pending' for update;
      if actor.role<>'branch' or actor.branch_id is distinct from h.branch_id then raise exception 'Only the selected branch can accept this backup request.'; end if;
      perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id
        where l.order_id=o.id and (i.branch_id=h.branch_id or i.branch_id is not distinct from o.source_branch_id)
        order by i.branch_id nulls first,i.product_id for update of i;
      if exists(select 1 from public.order_lines l left join public.inventory i on i.branch_id=h.branch_id and i.product_id=l.product_id
        where l.order_id=o.id and (i.id is null or i.protected_reserve<l.quantity)) then
        raise exception 'Insufficient wholesale backup stock. Retail pairs cannot fulfil this takeover; ask HQ for a backup refill or decline for insufficient stock.';
      end if;
      if o.dispatched_at is null then old_source:=o.source_branch_id; end if;
    end if;
  end if;
  result:=supplylink_private.workflow_execute_pre_pools(p_action,p_payload,p_key);
  if p_action='transfer_create' then
    update public.stock_transfers set purpose=v_purpose where id=(result->>'transferId')::uuid;
  elsif p_action='transfer_receive' and tr.destination_branch_id is not null and tr.purpose='backup' then
    update public.inventory set protected_reserve=protected_reserve+tr.quantity where inventory.branch_id=tr.destination_branch_id and product_id=tr.product_id;
  elsif p_action='transfer_cancel' and tr.source_branch_id is not null and tr.purpose='backup' then
    update public.inventory set protected_reserve=protected_reserve+tr.quantity where inventory.branch_id=tr.source_branch_id and product_id=tr.product_id;
  elsif p_action='handoff_accept' then
    if old_source is not null then
      update public.inventory i set protected_reserve=i.protected_reserve+a.quantity from supplylink_private.branch_backup_allocations a
        where a.order_id=o.id and a.branch_id=old_source and i.branch_id=a.branch_id and i.product_id=a.product_id;
    end if;
    delete from supplylink_private.branch_backup_allocations where order_id=o.id;
    insert into supplylink_private.branch_backup_allocations(order_id,branch_id,product_id,quantity)
      select o.id,h.branch_id,l.product_id,l.quantity from public.order_lines l where l.order_id=o.id;
  elsif p_action='cancel' and o.source_branch_id is not null then
    update public.inventory i set protected_reserve=i.protected_reserve+a.quantity from supplylink_private.branch_backup_allocations a
      where a.order_id=o.id and i.branch_id=a.branch_id and i.product_id=a.product_id;
    delete from supplylink_private.branch_backup_allocations where order_id=o.id;
  elsif p_action='dispatch' then
    delete from supplylink_private.branch_backup_allocations where order_id=o.id;
  end if;
  return result;
end; $$;
revoke all on function supplylink_private.workflow_with_stock_pools(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_with_stock_pools(text,jsonb,uuid) to authenticated;
create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$ select supplylink_private.workflow_with_stock_pools(p_action,p_payload,p_key); $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

-- Only dispatched transfers explicitly destined for backup may offset a backup plan.
alter function supplylink_private.planning_rows(uuid,date,integer,integer,integer) rename to planning_rows_pre_pools;
revoke all on function supplylink_private.planning_rows_pre_pools(uuid,date,integer,integer,integer) from public,anon,authenticated;
create function supplylink_private.planning_rows(p_branch uuid,p_month date,p_buffer integer,p_min_months integer,p_min_orders integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r.value||jsonb_build_object('configuredTarget',rt.target,'incoming',incoming.quantity,
    'refill',case when r.value->>'target' is null then null else greatest(0,(r.value->>'target')::integer-(r.value->>'carryover')::integer-incoming.quantity) end) order by r.ordinality),'[]'::jsonb)
  from jsonb_array_elements(supplylink_private.planning_rows_pre_pools(p_branch,p_month,p_buffer,p_min_months,p_min_orders)) with ordinality r(value,ordinality)
  left join supplylink_private.reserve_targets rt on rt.branch_id=p_branch and rt.product_id=(r.value->>'productId')::uuid
  cross join lateral (select coalesce(sum(t.quantity),0)::integer quantity from public.stock_transfers t
    join supplylink_private.planning_arrivals a on a.transfer_id=t.id where t.destination_branch_id=p_branch
    and t.product_id=(r.value->>'productId')::uuid and t.status='shipping' and t.purpose='backup'
    and a.due>=(now() at time zone 'Asia/Yangon')::date and a.due<=p_month) incoming;
$$;
revoke all on function supplylink_private.planning_rows(uuid,date,integer,integer,integer) from public,anon,authenticated;
alter function public.stock_planning(text,jsonb,uuid) rename to stock_planning_pre_pools;
alter function public.stock_planning_pre_pools(text,jsonb,uuid) set schema supplylink_private;
revoke all on function supplylink_private.stock_planning_pre_pools(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function supplylink_private.stock_planning(text,jsonb,uuid) from public,anon,authenticated;
create function supplylink_private.stock_planning_with_pools(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); result jsonb;
begin
  if actor.role<>'hq' then raise exception 'Stock planning is restricted to HQ.'; end if;
  if p_action='approve' and exists(select 1 from supplylink_private.stock_plans older join supplylink_private.stock_plans newer
    on newer.branch_id=older.branch_id and newer.month>older.month and newer.status='approved'
    where older.id=(p_payload->>'planId')::uuid and older.status='draft') then raise exception 'A later month is already approved. Review that month instead.'; end if;
  if p_action='arrival' and not exists(select 1 from public.stock_transfers where id=(p_payload->>'transferId')::uuid and purpose='backup') then
    raise exception 'Only a wholesale backup refill can be confirmed for a backup plan.';
  end if;
  result:=supplylink_private.stock_planning_pre_pools(p_action,p_payload,p_key);
  if p_action='snapshot' then
    result:=jsonb_set(result,'{incoming}',coalesce((select jsonb_agg(r.value order by r.ordinality)
      from jsonb_array_elements(result->'incoming') with ordinality r(value,ordinality)
      join public.stock_transfers t on t.id=(r.value->>'id')::uuid and t.purpose='backup'),'[]'::jsonb));
  end if;
  return result;
end; $$;
revoke all on function supplylink_private.stock_planning_with_pools(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function supplylink_private.stock_planning_with_pools(text,jsonb,uuid) to authenticated;
create function public.stock_planning(p_action text,p_payload jsonb,p_key uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select supplylink_private.stock_planning_with_pools(p_action,p_payload,p_key); $$;
revoke all on function public.stock_planning(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.stock_planning(text,jsonb,uuid) to authenticated;

-- Keep the original below-10 on-hand alert, and add shortages against configured backup targets.
alter table supplylink_private.branch_refill_requests add column pool text not null default 'on_hand' check(pool in ('on_hand','backup'));
alter table supplylink_private.branch_refill_requests drop constraint branch_refill_requests_threshold_check;
alter table supplylink_private.branch_refill_requests add check(threshold>=0);
drop index supplylink_private.branch_refill_one_open;
create unique index branch_refill_one_open on supplylink_private.branch_refill_requests(branch_id,product_id,pool) where resolved_at is null;
create function supplylink_private.sync_pool_refill_requests(p_branch uuid,p_product uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.inventory; target integer; pool_name text; balance integer; threshold_value integer;
begin
  if p_branch is null then return; end if;
  select * into inv from public.inventory where branch_id=p_branch and product_id=p_product;
  select rt.target into target from supplylink_private.reserve_targets rt where branch_id=p_branch and product_id=p_product;
  foreach pool_name in array array['on_hand','backup'] loop
    balance:=case when pool_name='backup' then coalesce(inv.protected_reserve,0) else coalesce(inv.on_hand,0) end;
    threshold_value:=case when pool_name='backup' then coalesce(target,0) else 10 end;
    if balance<threshold_value and exists(select 1 from public.branches where id=p_branch and active)
      and exists(select 1 from public.products where id=p_product and active and brand='STT') then
      insert into supplylink_private.branch_refill_requests(branch_id,product_id,pool,on_hand,threshold)
        values(p_branch,p_product,pool_name,balance,threshold_value)
        on conflict(branch_id,product_id,pool) where resolved_at is null do update set on_hand=excluded.on_hand,threshold=excluded.threshold,updated_at=now();
    else
      update supplylink_private.branch_refill_requests set on_hand=balance,threshold=threshold_value,resolved_at=now(),updated_at=now()
        where branch_id=p_branch and product_id=p_product and pool=pool_name and resolved_at is null;
    end if;
  end loop;
end; $$;
revoke all on function supplylink_private.sync_pool_refill_requests(uuid,uuid) from public,anon,authenticated;
create or replace function supplylink_private.capture_branch_refill_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform supplylink_private.sync_pool_refill_requests(new.branch_id,new.product_id); return new; end; $$;
drop trigger branch_refill_request on public.inventory;
create trigger branch_refill_request after insert or update of on_hand,protected_reserve,allocated on public.inventory
  for each row execute function supplylink_private.capture_branch_refill_request();
create trigger backup_target_refill_request after insert or update on supplylink_private.reserve_targets
  for each row execute function supplylink_private.capture_branch_refill_request();
select supplylink_private.sync_pool_refill_requests(branch_id,product_id) from supplylink_private.reserve_targets;

create or replace function supplylink_private.refill_notifications(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=supplylink_private.workspace_actor(); request_count bigint; request_rows jsonb;
begin
  if actor.role not in ('hq','branch') then return jsonb_build_object('refillRequests','[]'::jsonb,'refillRequestCount',0); end if;
  select count(*) into request_count from supplylink_private.branch_refill_requests r
    join public.branches b on b.id=r.branch_id and b.active join public.products p on p.id=r.product_id and p.active and p.brand='STT'
    where r.resolved_at is null and (p_branch is null or r.branch_id=p_branch) and (actor.role='hq' or r.branch_id=actor.branch_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'branchId',r.branch_id,'branchName',b.name,'productId',r.product_id,
    'variant',p.pack,'pool',r.pool,'onHand',r.on_hand,'threshold',r.threshold,'createdAt',r.created_at,
    'incoming',coalesce((select sum(t.quantity) from public.stock_transfers t where t.destination_branch_id=r.branch_id and t.product_id=r.product_id
      and t.status in ('reserved','shipping') and (r.pool='on_hand' or t.purpose='backup')),0)) order by r.created_at desc,r.id desc),'[]'::jsonb)
    into request_rows from (select req.* from supplylink_private.branch_refill_requests req
      join public.branches br on br.id=req.branch_id and br.active join public.products pr on pr.id=req.product_id and pr.active and pr.brand='STT'
      where req.resolved_at is null and (p_branch is null or req.branch_id=p_branch) and (actor.role='hq' or req.branch_id=actor.branch_id)
      order by req.created_at desc,req.id desc limit 100) r join public.branches b on b.id=r.branch_id join public.products p on p.id=r.product_id;
  return jsonb_build_object('refillRequests',request_rows,'refillRequestCount',request_count);
end; $$;

create function supplylink_private.transfers_with_purpose(p_rows jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r.value||jsonb_build_object('purpose',t.purpose) order by r.ordinality),'[]'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality r(value,ordinality) join public.stock_transfers t on t.id=(r.value->>'id')::uuid;
$$;
revoke all on function supplylink_private.transfers_with_purpose(jsonb) from public,anon,authenticated;
alter function supplylink_private.workflow_snapshot_with_refills(jsonb) rename to workflow_snapshot_pre_stock_pools;
revoke all on function supplylink_private.workflow_snapshot_pre_stock_pools(jsonb) from public,anon,authenticated;
create function supplylink_private.workflow_snapshot_with_refills(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; actor public.profiles:=supplylink_private.workspace_actor(); branches jsonb;
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
  return jsonb_set(result,'{transfers}',supplylink_private.transfers_with_purpose(result->'transfers'));
end; $$;
revoke all on function supplylink_private.workflow_snapshot_with_refills(jsonb) from public,anon,authenticated;
grant execute on function supplylink_private.workflow_snapshot_with_refills(jsonb) to authenticated;
alter function supplylink_private.branch_transfer_history(uuid,integer,integer) rename to branch_transfer_history_pre_stock_pools;
revoke all on function supplylink_private.branch_transfer_history_pre_stock_pools(uuid,integer,integer) from public,anon,authenticated;
create function supplylink_private.branch_transfer_history(p_branch uuid,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=supplylink_private.branch_transfer_history_pre_stock_pools(p_branch,p_page,p_page_size);
  return jsonb_set(result,'{rows}',supplylink_private.transfers_with_purpose(result->'rows'));
end; $$;
revoke all on function supplylink_private.branch_transfer_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function supplylink_private.branch_transfer_history(uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
