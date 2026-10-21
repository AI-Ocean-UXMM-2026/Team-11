-- Keep the latest driver/attempt visible to HQ and SME after Done.
-- Driver workspaces still contain active assignments only.
begin;
create or replace function public.workflow_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; response jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and not must_change_password;
  if actor.id is null then raise exception 'An active signed-in account is required.'; end if;
  if (select count(*) from public.orders)>10000 then raise exception 'The synchronous workspace limit is 10000 orders. Configure paginated reporting before continuing.'; end if;
  select jsonb_build_object(
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'reference',o.reference,'business',o.business_name,'initials',upper(left(o.business_name,2)),
      'location',o.destination,'items',o.item_count,'merchandise',case when actor.role='driver' then 0 else o.merchandise_total end,
      'shipping',case when actor.role='driver' then 0 else o.shipping_total end,'status',o.status,
      'date',to_char(o.created_at at time zone 'Asia/Yangon','YYYY-MM-DD'),
      'salesDate',case when o.done_at is null then null else to_char(o.done_at at time zone 'Asia/Yangon','YYYY-MM-DD') end,'source',o.source_name,
      'workflow',jsonb_build_object('receiver',o.receiver_name,'phone',o.receiver_phone,'notes',o.notes,'paymentVerified',case when actor.role='driver' then false else o.payment_verified_at is not null end,
        'reserved',o.reserved_at is not null,'hqComplete',o.hq_completed_at is not null,'received',o.sme_received_at is not null,'issue',o.issue_reason,'refundRequired',o.refund_required,
        'instructions',case when actor.role='driver' then '' else o.payment_instructions end,
        'driverId',a.driver_id,'driverName',(select name from public.profiles where id=a.driver_id),'handover',a.status='handed_over',
        'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'quantity',l.quantity,'unitPrice',case when actor.role='driver' then null else l.unit_price end))) from public.order_lines l where l.order_id=o.id),'[]'::jsonb),
        'evidence',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'amount',e.claimed_amount,'verifiedAmount',e.verified_amount,'reference',e.transfer_reference,'status',e.status,'reason',e.reason,'createdAt',e.created_at) order by e.version desc) from public.payment_evidence e where e.order_id=o.id),'[]'::jsonb) end,
        'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'reason',ev.reason,'at',ev.created_at,'actor',(select name from public.profiles where id=ev.actor_id)) order by ev.created_at,ev.id) from public.order_events ev where ev.order_id=o.id),'[]'::jsonb)
      )) order by o.created_at desc)
      from public.orders o left join lateral (select * from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1) a on true
      where actor.role='hq' or (actor.role='sme' and o.sme_id=actor.id) or (actor.role='driver' and a.driver_id=actor.id and a.active)), '[]'::jsonb),
    'products',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'pack',p.pack,'price',p.wholesale_price,
      'stock',case when actor.role='sme' then greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) else coalesce(i.on_hand,0) end,
      'reserve',case when actor.role='sme' then 0 else coalesce(i.allocated+i.protected_reserve,0) end,'minimum',p.minimum_packs,'tone',p.tone,'brand',p.brand,'size',p.size,'color',p.color) order by p.color,p.size)
      from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id is not distinct from (case when actor.role='branch' then actor.branch_id else null end) where p.brand='STT' and p.active),'[]'::jsonb) end,
    'branches',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'manager',b.manager_name,'sales',0,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',(select count(*) from public.inventory where branch_id=b.id and on_hand-protected_reserve-allocated<10))) from public.branches b where b.active and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
    'accounts',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'status',case when status='suspended' then 'Suspended' when not must_change_password then 'Active' else 'Pending setup' end,'affiliation',address)) from public.profiles where role in ('sme','driver')),'[]'::jsonb) else '[]'::jsonb end,
    'retailSales',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',s.reference,'branchId',s.branch_id,'description',coalesce((select string_agg(p.name||' · '||p.pack,', ') from public.retail_sale_lines l join public.products p on p.id=l.product_id where l.sale_id=s.id),'Retail sale'),'amount',s.merchandise_total,'packs',(select sum(quantity) from public.retail_sale_lines where sale_id=s.id),'date',to_char(s.confirmed_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by s.confirmed_at desc) from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id),'[]'::jsonb) else '[]'::jsonb end,
    'salesEvents',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'reference',e.reference,'orderId',e.order_id,'channel',e.channel,'amount',e.merchandise,'units',e.units,'branchId',e.branch_id,'date',to_char(e.occurred_at at time zone 'Asia/Yangon','YYYY-MM-DD'))) from public.sales_events e where actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id)),'[]'::jsonb) else '[]'::jsonb end,
    'settings',jsonb_build_object('shipping',case when actor.role='driver' then null else s.shipping_fee end,'instructions',case when actor.role='driver' then '' else s.payment_instructions end,'area',s.delivery_area),
    'workflowEnabled',true
  ) into response from public.workflow_settings s where singleton;
  return response;
end; $$;
revoke all on function public.workflow_snapshot() from public,anon;
grant execute on function public.workflow_snapshot() to authenticated;
commit;
