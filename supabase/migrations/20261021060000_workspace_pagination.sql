-- Bounded operational history and full-dataset report aggregates.
begin;
create index orders_created_page on public.orders(created_at desc,id desc);
create index orders_sme_page on public.orders(sme_id,created_at desc,id desc);
create index orders_source_page on public.orders(source_branch_id,created_at desc,id desc);
create index attempts_order_latest on public.delivery_attempts(order_id,active desc,created_at desc,id desc);
create index retail_created_page on public.retail_sales(confirmed_at desc,id desc);
create index retail_branch_page on public.retail_sales(branch_id,confirmed_at desc,id desc);
create index sales_created_page on public.sales_events(occurred_at desc,id desc);
create index sales_branch_page on public.sales_events(branch_id,occurred_at desc,id desc);
create index transfers_created_page on public.stock_transfers(created_at desc,id desc);

create function supplylink_private.workspace_actor() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and not must_change_password;
  if actor.id is null then raise exception 'An active signed-in account is required.'; end if;
  if actor.branch_id is not null and not exists(select 1 from public.branches where id=actor.branch_id and active) then raise exception 'This branch is closed.'; end if;
  return actor;
end; $$;
revoke all on function supplylink_private.workspace_actor() from public,anon,authenticated;

create function supplylink_private.scoped_orders(actor public.profiles) returns setof public.orders
language sql stable security definer set search_path='' as $$
  select o.* from public.orders o
  left join lateral (select * from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1) a on true
  where actor.role='hq' or (actor.role='sme' and o.sme_id=actor.id)
    or (actor.role='driver' and a.driver_id=actor.id and a.active)
    or (actor.role='branch' and (o.source_branch_id=actor.branch_id or exists(select 1 from public.delivery_handoffs h where h.order_id=o.id and h.branch_id=actor.branch_id and h.status='pending')));
$$;
revoke all on function supplylink_private.scoped_orders(public.profiles) from public,anon,authenticated;

create function public.workflow_list(p_kind text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  page_number integer:=coalesce((p_query->>'page')::integer,1);
  page_size integer:=coalesce((p_query->>'pageSize')::integer,25);
  row_count bigint; rows_json jsonb; totals jsonb:='{}';
  search_text text:=lower(trim(coalesce(p_query->>'search','')));
  status_filter text:=coalesce(p_query->>'status','All orders');
  selected_id uuid:=nullif(p_query->>'orderId','')::uuid;
  date_from date:=coalesce((p_query->>'reportFrom')::date,date_trunc('month',now() at time zone 'Asia/Yangon')::date);
  date_to date:=coalesce((p_query->>'reportTo')::date,(now() at time zone 'Asia/Yangon')::date);
  channel_filter text:=coalesce(p_query->>'reportChannel','All channels');
  cutoff timestamptz:=coalesce((p_query->>'reportCutoff')::timestamptz,statement_timestamp());
  page_offset bigint;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'Invalid query.'; end if;
  if page_number not between 1 and 1000000 or page_size not in (25,50,100) or length(search_text)>120 then raise exception 'Invalid pagination.'; end if;
  if status_filter not in ('All orders','Draft','Awaiting verification','Confirmed','Preparing','Shipping','On hold','Complete','Done','Cancelled') then raise exception 'Invalid order status.'; end if;
  if date_from>date_to or channel_filter not in ('All channels','Retail','Wholesale') or cutoff>statement_timestamp() then raise exception 'Invalid report selection.'; end if;
  if p_kind='orders' then
    select count(*) into row_count from supplylink_private.scoped_orders(actor) o
      where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
        and (status_filter='All orders' or o.status::text=status_filter)
        and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer));
    page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'reference',o.reference,'business',o.business_name,'initials',upper(left(o.business_name,2)),
      'location',o.destination,'items',o.item_count,'merchandise',case when actor.role in ('driver','branch') then 0 else o.merchandise_total end,
      'shipping',case when actor.role in ('driver','branch') then 0 else o.shipping_total end,'status',o.status,
      'date',to_char(o.created_at at time zone 'Asia/Yangon','YYYY-MM-DD'),
      'salesDate',case when o.done_at is null then null else to_char(o.done_at at time zone 'Asia/Yangon','YYYY-MM-DD') end,'source',o.source_name,
      'workflow',jsonb_build_object('receiver',o.receiver_name,'phone',o.receiver_phone,'notes',o.notes,'paymentVerified',case when actor.role in ('driver','branch') then false else o.payment_verified_at is not null end,
        'reserved',o.reserved_at is not null,'hqComplete',o.hq_completed_at is not null,'received',o.sme_received_at is not null,'issue',o.issue_reason,'refundRequired',o.refund_required,
        'instructions',case when actor.role in ('driver','branch') then '' else o.payment_instructions end,
        'dispatched',o.dispatched_at is not null,'sourceBranchId',o.source_branch_id,'handoffPending',o.handoff_pending,'replacementRequired',o.replacement_required,
        'handoffs',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'branchId',h.branch_id,'branchName',(select name from public.branches where id=h.branch_id),'status',h.status,'resolution',h.original_resolution,'reason',h.reason,'responseReason',h.response_reason,'at',h.created_at) order by h.created_at desc,h.id desc) from public.delivery_handoffs h where h.order_id=o.id),'[]'::jsonb),
        'driverId',case when a.active or o.status in ('Done','Cancelled') then a.driver_id else null end,'driverName',case when a.active or o.status in ('Done','Cancelled') then (select name from public.profiles where id=a.driver_id) else null end,'handover',a.active and a.status='handed_over',
        'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'quantity',l.quantity,'unitPrice',case when actor.role in ('driver','branch') then null else l.unit_price end))) from public.order_lines l where l.order_id=o.id),'[]'::jsonb),
        'evidence',case when actor.role in ('driver','branch') then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'amount',e.claimed_amount,'verifiedAmount',e.verified_amount,'reference',e.transfer_reference,'status',e.status,'reason',e.reason,'createdAt',e.created_at) order by e.version desc) from public.payment_evidence e where e.order_id=o.id),'[]'::jsonb) end,
        'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'reason',ev.reason,'at',ev.created_at,'actor',(select name from public.profiles where id=ev.actor_id)) order by ev.created_at,ev.id) from public.order_events ev where ev.order_id=o.id),'[]'::jsonb)
      )) order by o.created_at desc,o.id desc),'[]'::jsonb) into rows_json
      from (select * from supplylink_private.scoped_orders(actor) o
        where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
          and (status_filter='All orders' or o.status::text=status_filter)
          and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0)
        order by o.created_at desc,o.id desc limit page_size offset page_offset) o
      left join lateral (select * from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1) a on true;
  elsif p_kind='retail' then
    if actor.role not in ('hq','branch') then raise exception 'Retail history is restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',s.reference,'branchId',s.branch_id,'description',coalesce((select string_agg(p.name||' · '||p.pack,', ') from public.retail_sale_lines l join public.products p on p.id=l.product_id where l.sale_id=s.id),'Retail sale'),'amount',s.merchandise_total,'packs',coalesce((select sum(quantity) from public.retail_sale_lines where sale_id=s.id),0),'date',to_char(s.confirmed_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by s.confirmed_at desc,s.id desc),'[]'::jsonb) into rows_json
      from (select * from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id order by s.confirmed_at desc,s.id desc limit page_size offset page_offset) s;
  elsif p_kind='transfers' then
    if actor.role not in ('hq','branch') then raise exception 'Transfers are restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'sourceBranchId',t.source_branch_id,'destinationBranchId',t.destination_branch_id,'source',coalesce((select name from public.branches where id=t.source_branch_id),'STT Yangon HQ'),'destination',coalesce((select name from public.branches where id=t.destination_branch_id),'STT Yangon HQ'),'productId',t.product_id,'variant',(select pack from public.products where id=t.product_id),'quantity',t.quantity,'status',t.status,'reason',t.reason,'createdAt',t.created_at) order by t.created_at desc,t.id desc),'[]'::jsonb) into rows_json
      from (select * from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id order by t.created_at desc,t.id desc limit page_size offset page_offset) t;
  elsif p_kind='report' then
    if actor.role not in ('hq','branch') then raise exception 'Sales reports are restricted to HQ and branch staff.'; end if;
    select count(*),jsonb_build_object('wholesale',coalesce(sum(e.merchandise) filter(where e.channel='Wholesale'),0),'retail',coalesce(sum(e.merchandise) filter(where e.channel='Retail'),0)) into row_count,totals
      from public.sales_events e
      where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
        and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
        and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'reference',e.reference,'orderId',e.order_id,'channel',e.channel,'amount',e.merchandise,'units',e.units,'branchId',e.branch_id,'date',to_char(e.occurred_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into rows_json
      from (select * from public.sales_events e
        where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
          and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
          and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter)
        order by e.occurred_at desc,e.id desc limit page_size offset page_offset) e;
  else raise exception 'Unknown list.';
  end if;
  return jsonb_build_object('rows',rows_json,'total',row_count,'page',page_number,'pageSize',page_size,'summary',totals,'cutoff',cutoff);
end; $$;
revoke all on function public.workflow_list(text,jsonb) from public,anon;
grant execute on function public.workflow_list(text,jsonb) to authenticated;

create function public.workflow_snapshot(p_query jsonb) returns jsonb
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
      'inventory',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'variant',p.pack,'onHand',coalesce(i.on_hand,0),'allocated',coalesce(i.allocated,0),'protected',coalesce(i.protected_reserve,0))) from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=b.id where p.brand='STT' and p.active),'[]'::jsonb) else '[]'::jsonb end,'sales',0,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',(select count(*) from public.inventory where branch_id=b.id and on_hand-protected_reserve-allocated<10))) from public.branches b where (actor.role='hq' or b.active) and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
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
-- Existing API clients get a bounded first page too.
create or replace function public.workflow_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$ select public.workflow_snapshot('{}'::jsonb); $$;
revoke all on function public.workflow_snapshot() from public,anon;
grant execute on function public.workflow_snapshot() to authenticated;
commit;
