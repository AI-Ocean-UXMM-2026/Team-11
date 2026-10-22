import type { Transaction } from "@electric-sql/pglite";
import { isDemoMode } from "../supabase/config";

// Local demo fixtures only. Never called by the hosted Supabase path.
// Historical inserts do not execute stock movements against current balances.
export async function seedDemoPlanningHistory(tx: Transaction) {
  if (!isDemoMode()) return;
  const { rows } = await tx.query<{ marker: string }>(`
    select 'demo_backup_history_v1:'||to_char(now() at time zone 'Asia/Yangon','YYYY-MM')||':'||
      md5(coalesce((select string_agg(id::text,',' order by id) from public.branches where active),'')||'/'||
          coalesce((select string_agg(id::text,',' order by id) from public.products where active and brand='STT'),'')) marker
  `);
  const marker = rows[0].marker;
  if (
    (
      await tx.query("select 1 from public.workflow_migrations where name=$1", [
        marker,
      ])
    ).rows.length
  )
    return;
  const profiles = (
    await tx.query<{ id: string; role: string; name: string; phone: string }>(
      "select id,role,name,phone from public.profiles where role in ('hq','sme') and status='active' order by username",
    )
  ).rows;
  const hq = profiles.find((p) => p.role === "hq"),
    buyer = profiles.find((p) => p.role === "sme");
  if (!hq || !buyer) return;
  await tx.query(
    `
    create temporary table backup_history_fixture on commit drop as
    select x.*,md5('backup-history-order-v1:'||fixture_key)::uuid order_id,
      md5('backup-history-handoff-v1:'||fixture_key)::uuid handoff_id,
      ('OPL-'||to_char(period,'YYYYMM')||'-'||upper(substr(md5(fixture_key),1,10))) reference,
      (period::timestamp+interval '8 days 9 hours'+seq*interval '10 days') at time zone 'Asia/Yangon' requested_at
    from (
      select b.id branch_id,b.name branch_name,p.id product_id,p.name product_name,p.pack,
        p.wholesale_price,coalesce(rt.stock_unit,'pairs') stock_unit,
        coalesce(i.on_hand,0) opening_stock,coalesce(i.allocated,0) opening_allocated,coalesce(i.protected_reserve,0) opening_backup,
        coalesce((select id from public.profiles where branch_id=b.id and role='branch' order by created_at limit 1),$1::uuid) branch_actor,
        m::date period,n seq,
        5+extract(month from m)::integer%4+n*3+ascii(left(p.id::text,1))%3 quantity,
        b.id::text||':'||p.id::text||':'||m::date::text||':'||n::text fixture_key
      from public.branches b cross join public.products p
      cross join generate_series(date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months',
        date_trunc('month',now() at time zone 'Asia/Yangon')-interval '1 month',interval '1 month') m
      cross join generate_series(0,1) n
      left join public.inventory i on i.branch_id=b.id and i.product_id=p.id
      left join supplylink_private.reserve_targets rt on rt.branch_id=b.id and rt.product_id=p.id
      where b.active and p.active and p.brand='STT'
    ) x
  `,
    [hq.id],
  );
  // Retain original dates in the internal audit record before extending this
  // explicitly requested local fixture's observation/branch/product timeline.
  await tx.query(
    `insert into public.audit_events(actor_id,action,details)
    select $1,'local.planning_history',jsonb_build_object('fixtureVersion',1,'marker',$2::text,
      'originalCoverage',(select observed_since from supplylink_private.planning_config),
      'originalBranchDates',(select jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at)) from public.branches where active),
      'originalProductDates',(select jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at)) from public.products where active and brand='STT'))`,
    [hq.id, marker],
  );
  await tx.exec(`
    update supplylink_private.planning_config set observed_since=least(observed_since,
      (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months') at time zone 'Asia/Yangon');
    update public.branches set created_at=least(created_at,
      (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months') at time zone 'Asia/Yangon') where active;
    update public.products set created_at=least(created_at,
      (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months') at time zone 'Asia/Yangon') where active and brand='STT';
    insert into supplylink_private.stock_observations(branch_id,product_id,on_hand,allocated,protected,observed_at)
      select distinct f.branch_id,f.product_id,f.opening_stock,f.opening_allocated,f.opening_backup,
        (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months') at time zone 'Asia/Yangon'
      from backup_history_fixture f where not exists(select 1 from supplylink_private.stock_observations o
        where o.branch_id=f.branch_id and o.product_id=f.product_id and o.observed_at<=
        (date_trunc('month',now() at time zone 'Asia/Yangon')-interval '3 months') at time zone 'Asia/Yangon');
  `);
  await tx.query(
    `
    insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,
      merchandise_total,shipping_total,status,source_branch_id,source_name,created_at,payment_verified_at,reserved_at,
      dispatched_at,sme_received_at,hq_completed_at,done_at)
    select f.order_id,f.reference,$1,$2,'Yangon',$2,$3,f.quantity,f.quantity*f.wholesale_price,0,'Done',f.branch_id,f.branch_name,
      f.requested_at-interval '1 hour',f.requested_at-interval '30 minutes',f.requested_at+interval '20 minutes',
      f.requested_at+interval '1 hour',f.requested_at+interval '5 hours',f.requested_at+interval '5 hours 15 minutes',f.requested_at+interval '5 hours 15 minutes'
    from backup_history_fixture f on conflict(id) do nothing;
    `,
    [buyer.id, buyer.name, buyer.phone || "09123456789"],
  );
  await tx.exec(`
    insert into public.order_lines(id,order_id,product_id,product_name,pack_snapshot,quantity,unit_price)
      select md5('line:'||order_id::text)::uuid,order_id,product_id,product_name,pack,quantity,wholesale_price
      from backup_history_fixture on conflict(id) do nothing;
  `);
  await tx.query(
    `
    insert into public.delivery_handoffs(id,order_id,branch_id,status,original_resolution,reason,created_by,created_at,responded_by,responded_at)
      select handoff_id,order_id,branch_id,'accepted','HQ consignment not dispatched',
        case seq when 0 then 'HQ vehicle breakdown put the original wholesale deadline at risk.'
          else 'HQ route congestion prevented delivery by the wholesale deadline.' end,
        $1,requested_at,branch_actor,requested_at+interval '20 minutes'
      from backup_history_fixture on conflict(id) do nothing;
    `,
    [hq.id],
  );
  await tx.exec(`
    insert into supplylink_private.takeover_details(handoff_id,deadline,lines)
      select handoff_id,requested_at+interval '8 hours',jsonb_build_array(jsonb_build_object('productId',product_id,'quantity',quantity,'unit',stock_unit))
      from backup_history_fixture on conflict(handoff_id) do nothing;
    insert into public.delivery_attempts(id,order_id,source_branch_id,status,active,dispatched_at,created_at)
      select md5('attempt:'||order_id::text)::uuid,order_id,branch_id,'handed_over',false,requested_at+interval '1 hour',requested_at+interval '30 minutes'
      from backup_history_fixture on conflict(id) do nothing;
    insert into public.inventory_movements(product_id,branch_id,order_id,actor_id,kind,quantity,reason,created_at)
      select product_id,branch_id,order_id,branch_actor,'dispatch',-quantity,'Emergency wholesale delivery from backup',requested_at+interval '1 hour'
      from backup_history_fixture on conflict(order_id,product_id,kind) do nothing;
    insert into public.sales_events(id,reference,channel,order_id,branch_id,merchandise,units,occurred_at)
      select md5('sale:'||order_id::text)::uuid,reference,'Wholesale',order_id,branch_id,quantity*wholesale_price,quantity,requested_at+interval '5 hours 15 minutes'
      from backup_history_fixture on conflict(order_id) do nothing;
  `);
  await tx.query(
    `
    insert into public.order_events(order_id,actor_id,action,reason,created_at)
      select f.order_id,e.actor,e.action,e.reason,e.at from backup_history_fixture f cross join lateral(values
        ($1::uuid,'route_branch','HQ requested branch backup to meet the original deadline',f.requested_at),
        (f.branch_actor,'handoff_accept','Branch accepted and reserved dedicated backup',f.requested_at+interval '20 minutes'),
        (f.branch_actor,'dispatch','Wholesale delivery dispatched from branch backup',f.requested_at+interval '1 hour'),
        ($2::uuid,'receive','Original wholesale order received in full',f.requested_at+interval '5 hours')
      ) e(actor,action,reason,at) where not exists(select 1 from public.order_events old where old.order_id=f.order_id and old.action=e.action);
    `,
    [hq.id, buyer.id],
  );
  await tx.query(
    `
    insert into public.stock_transfers(id,reference,destination_branch_id,product_id,quantity,purpose,status,reason,created_by,dispatched_by,received_by,created_at,dispatched_at,received_at)
      select md5('refill:'||branch_id::text||product_id::text||period::text)::uuid,
        'TR-'||upper(substr(md5('refill:'||branch_id::text||product_id::text||period::text),1,10)),branch_id,product_id,sum(quantity)::integer,
        'backup','received','Emergency wholesale backup replenishment',$1,$1,min(branch_actor::text)::uuid,
        (period::timestamp+interval '1 day') at time zone 'Asia/Yangon',
        (period::timestamp+interval '2 days') at time zone 'Asia/Yangon',
        (period::timestamp+interval '2 days'+(2+extract(month from period)::integer%3)*interval '1 day') at time zone 'Asia/Yangon'
      from backup_history_fixture group by branch_id,product_id,period on conflict(id) do nothing;
    `,
    [hq.id],
  );
  await tx.query(
    "insert into public.workflow_migrations(name) values($1) on conflict do nothing",
    [marker],
  );
}
