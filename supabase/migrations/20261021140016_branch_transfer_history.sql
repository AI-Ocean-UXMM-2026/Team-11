-- A bounded branch-specific ledger; operational writes stay in workflow_execute.
begin;
create function supplylink_private.branch_transfer_history(p_branch uuid, p_page integer, p_page_size integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles := supplylink_private.workspace_actor();
  row_count bigint; pending_count bigint; page_number integer; rows_json jsonb;
begin
  if actor.role <> 'hq' then raise exception 'Branch management is restricted to HQ.' using errcode='42501'; end if;
  if p_branch is null or not exists(select 1 from public.branches where id=p_branch) then
    raise exception 'Branch not found.' using errcode='P0002';
  end if;
  if p_page is null or p_page < 1 or p_page > 1000000 or p_page_size is null or p_page_size not in (25,50,100) then
    raise exception 'Invalid history page.' using errcode='22023';
  end if;
  select count(*), count(*) filter(where status in ('reserved','shipping')) into row_count,pending_count
    from public.stock_transfers where source_branch_id=p_branch or destination_branch_id=p_branch;
  page_number := least(p_page,greatest(1,ceil(row_count::numeric/p_page_size)::integer));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'reference',t.reference,'sourceBranchId',t.source_branch_id,'destinationBranchId',t.destination_branch_id,
    'source',coalesce(s.name,'STT Yangon HQ'),'destination',coalesce(d.name,'STT Yangon HQ'),
    'productId',t.product_id,'variant',p.pack,'quantity',t.quantity,'status',t.status,'reason',t.reason,
    'createdAt',t.created_at,'dispatchedAt',t.dispatched_at,'receivedAt',t.received_at
  ) order by t.created_at desc,t.id desc),'[]'::jsonb) into rows_json
  from (select * from public.stock_transfers where source_branch_id=p_branch or destination_branch_id=p_branch
    order by created_at desc,id desc limit p_page_size offset (page_number::bigint-1)*p_page_size) t
  join public.products p on p.id=t.product_id
  left join public.branches s on s.id=t.source_branch_id
  left join public.branches d on d.id=t.destination_branch_id;
  return jsonb_build_object('rows',rows_json,'pending',pending_count,
    'pagination',jsonb_build_object('page',page_number,'pageSize',p_page_size,'total',row_count));
end; $$;
revoke all on function supplylink_private.branch_transfer_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function supplylink_private.branch_transfer_history(uuid,integer,integer) to authenticated;
create function public.branch_transfer_history(p_branch uuid,p_page integer default 1,p_page_size integer default 25)
returns jsonb language sql stable security invoker set search_path='' as $$
  select supplylink_private.branch_transfer_history(p_branch,p_page,p_page_size);
$$;
revoke all on function public.branch_transfer_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.branch_transfer_history(uuid,integer,integer) to authenticated;
commit;
