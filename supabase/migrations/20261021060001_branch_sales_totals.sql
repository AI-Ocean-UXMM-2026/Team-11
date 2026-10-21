-- Keep branch overview totals independent of the retail history page.
begin;
create or replace function public.workflow_snapshot(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor(); response jsonb;
  order_page jsonb; retail_page jsonb; transfer_page jsonb; report_page jsonb;
  selected_order jsonb:=null; stats jsonb;
  empty_page jsonb:=jsonb_build_object('rows','[]'::jsonb,'total',0,'page',1,'pageSize',coalesce((p_query->>'pageSize')::integer,25));
  query jsonb:=p_query-'orderId';
begin
  order_page:=public.workflow_list('orders',query||jsonb_build_object('page',coalesce((query->>'ordersPage')::integer,1)));
  retail_page:=empty_page; transfer_page:=empty_page; report_page:=empty_page;
  if actor.role in ('hq','branch') then
    retail_page:=public.workflow_list('retail',query||jsonb_build_object('page',coalesce((query->>'retailPage')::integer,1)));
    transfer_page:=public.workflow_list('transfers',query||jsonb_build_object('page',coalesce((query->>'transfersPage')::integer,1)));
    report_page:=public.workflow_list('report',query||jsonb_build_object('page',coalesce((query->>'reportPage')::integer,1)));
  end if;
  if nullif(p_query->>'orderId','') is not null then
    selected_order:=(public.workflow_list('orders',jsonb_build_object('orderId',p_query->>'orderId'))->'rows')->0;
  end if;
  select jsonb_build_object('orders',count(*),'active',count(*) filter(where status not in ('Done','Cancelled','Draft')),'awaiting',count(*) filter(where status='Awaiting verification'),'held',count(*) filter(where status='On hold'),'shipping',count(*) filter(where status='Shipping'),'wholesale',case when actor.role in ('hq','sme') then coalesce(sum(merchandise_total) filter(where status='Done'),0) else 0 end)
    into stats from supplylink_private.scoped_orders(actor);
  stats:=stats||jsonb_build_object(
    'retail',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where actor.role='hq' or branch_id=actor.branch_id),0) else 0 end,
    'retailCount',retail_page->'total',
    'pendingTransfers',case when actor.role in ('hq','branch') then (select count(*) from public.stock_transfers where status in ('reserved','shipping') and (actor.role='hq' or source_branch_id=actor.branch_id or destination_branch_id=actor.branch_id)) else 0 end);
  select jsonb_build_object(
    'orders',order_page->'rows',
    'attentionOrders',public.workflow_list('orders',jsonb_build_object('attention',true))->'rows',
    'products',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'pack',p.pack,'price',p.wholesale_price,
      'stock',case when actor.role='sme' then greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) else coalesce(i.on_hand,0) end,
      'reserve',case when actor.role='sme' then 0 else coalesce(i.allocated+i.protected_reserve,0) end,'minimum',p.minimum_packs,'tone',p.tone,'brand',p.brand,'size',p.size,'color',p.color) order by p.color,p.size)
      from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id is not distinct from (case when actor.role='branch' then actor.branch_id else null end) where p.brand='STT' and p.active),'[]'::jsonb) end,
    'branches',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'manager',b.manager_name,'active',b.active,'closedAt',b.closed_at,
      'driverCount',(select count(*) from public.profiles where branch_id=b.id and role='driver' and status='active'),
      'staffCount',(select count(*) from public.profiles where branch_id=b.id and role='branch' and status='active'),
      'inventory',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'variant',p.pack,'onHand',coalesce(i.on_hand,0),'allocated',coalesce(i.allocated,0),'protected',coalesce(i.protected_reserve,0))) from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=b.id where p.brand='STT' and p.active),'[]'::jsonb) else '[]'::jsonb end,'sales',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where branch_id=b.id),0) else 0 end,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',(select count(*) from public.inventory where branch_id=b.id and on_hand-protected_reserve-allocated<10))) from public.branches b where (actor.role='hq' or b.active) and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
    'accounts',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'username',p.username,'role',p.role,'branchId',p.branch_id,'branchName',coalesce(b.name,'STT Yangon HQ'),'status',case when p.status='suspended' then 'Suspended' when p.must_change_password then 'Pending setup' else 'Active' end,'affiliation',case when p.role in ('branch','driver') then coalesce(b.name,'STT Yangon HQ') else p.address end)) from public.profiles p left join public.branches b on b.id=p.branch_id where (actor.role='hq' and p.role in ('sme','driver','branch')) or (actor.role='branch' and p.role='driver' and p.branch_id=actor.branch_id)),'[]'::jsonb) else '[]'::jsonb end,
    'settings',jsonb_build_object('shipping',case when actor.role in ('driver','branch') then null else s.shipping_fee end,'instructions',case when actor.role in ('driver','branch') then '' else s.payment_instructions end,'area',s.delivery_area),
    'retailSales',retail_page->'rows','salesEvents',report_page->'rows','transfers',transfer_page->'rows',
    'selectedOrder',selected_order,'summary',stats,
    'report',coalesce(report_page->'summary','{}'::jsonb)||jsonb_build_object('cutoff',report_page->'cutoff'),
    'pagination',jsonb_build_object('orders',order_page-'rows'-'summary'-'cutoff','retail',retail_page-'rows','transfers',transfer_page-'rows','report',report_page-'rows'-'summary'-'cutoff'),
    'query',query||jsonb_strip_nulls(jsonb_build_object('orderId',p_query->>'orderId','ordersPage',order_page->'page','retailPage',retail_page->'page','transfersPage',transfer_page->'page','reportPage',report_page->'page','pageSize',order_page->'pageSize','reportFrom',coalesce(query->>'reportFrom',to_char(date_trunc('month',now() at time zone 'Asia/Yangon'),'YYYY-MM-DD')),'reportTo',coalesce(query->>'reportTo',to_char(now() at time zone 'Asia/Yangon','YYYY-MM-DD')),'reportCutoff',report_page->>'cutoff')),
    'workflowEnabled',true
  ) into response from public.workflow_settings s where singleton;
  return response;
end; $$;
revoke all on function public.workflow_snapshot(jsonb) from public,anon;
grant execute on function public.workflow_snapshot(jsonb) to authenticated;
commit;
