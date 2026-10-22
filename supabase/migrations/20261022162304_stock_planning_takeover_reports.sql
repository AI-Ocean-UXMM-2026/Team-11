-- HQ-only, paged takeover history for the Reports workspace.
begin;

create function public.stock_planning_takeover_report(p_page integer default 1,p_page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  total_count bigint;
  rows jsonb;
begin
  if actor.role<>'hq' then raise exception 'Takeover history is restricted to HQ.' using errcode='42501'; end if;
  if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (25,50,100) then raise exception 'Choose a valid takeover history page.'; end if;
  select count(*) into total_count
  from public.delivery_handoffs h
  join public.orders o on o.id=h.order_id
  join public.order_lines l on l.order_id=o.id
  where h.original_resolution is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',page.id,'orderId',page.order_id,'reference',page.reference,
    'branchName',page.branch_name,'productId',page.product_id,'variant',page.variant,
    'quantity',page.quantity,'unit',page.unit,'reason',page.reason,
    'resolution',page.resolution,'responseReason',page.response_reason,
    'deadline',page.deadline,'fulfilledAt',page.fulfilled_at,'status',page.status,
    'actor',page.actor_name,'at',page.created_at,'events',page.events
  ) order by page.created_at desc,page.id desc,page.product_id),'[]'::jsonb) into rows
  from (
    select h.id,h.order_id,o.reference,b.name branch_name,l.product_id,l.pack_snapshot variant,l.quantity,
      coalesce((select x->>'unit' from jsonb_array_elements(d.lines) x where x->>'productId'=l.product_id::text),'pairs') unit,
      h.reason,h.original_resolution resolution,h.response_reason,d.deadline,o.sme_received_at fulfilled_at,
      case when o.status='Cancelled' then 'cancelled' when h.status<>'accepted' then h.status
        when o.source_branch_id is distinct from h.branch_id then 'replaced' when o.sme_received_at is not null then 'fulfilled'
        when o.dispatched_at is not null then 'in transit' else 'reserved' end status,
      coalesce(profile.name,'HQ user') actor_name,h.created_at,
      coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'at',e.created_at,'actor',ep.name) order by e.created_at)
        from public.order_events e join public.profiles ep on ep.id=e.actor_id where e.order_id=o.id),'[]'::jsonb) events
    from public.delivery_handoffs h
    join public.orders o on o.id=h.order_id
    join public.branches b on b.id=h.branch_id
    join public.order_lines l on l.order_id=o.id
    join public.profiles profile on profile.id=h.created_by
    left join supplylink_private.takeover_details d on d.handoff_id=h.id
    where h.original_resolution is not null
    order by h.created_at desc,h.id desc,l.product_id
    offset (p_page-1)*p_page_size limit p_page_size
  ) page;
  return jsonb_build_object('rows',rows,'total',total_count,'page',p_page,'pageSize',p_page_size);
end; $$;
revoke all on function public.stock_planning_takeover_report(integer,integer) from public,anon;
grant execute on function public.stock_planning_takeover_report(integer,integer) to authenticated;
comment on function public.stock_planning_takeover_report(integer,integer) is 'HQ-only paged takeover history for Reports.';

notify pgrst,'reload schema';
commit;
