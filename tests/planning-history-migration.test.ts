import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type {
  BackupRecommendation,
  PlanningRow,
} from "../src/lib/stock-planning";

const migration = "20261022104651_stock_planning_three_month_history.sql";
const db = new PGlite();
const branch = randomUUID(),
  hq = randomUUID(),
  buyer = randomUUID();
let product: string, sql: string, original: unknown;
const batch = "three_month_backup_history_v1";
async function operationalState() {
  const result: Record<string, unknown> = {};
  for (const table of [
    "public.branches",
    "public.products",
    "public.inventory",
    "public.orders",
    "public.order_lines",
    "public.delivery_handoffs",
    "public.stock_transfers",
    "public.inventory_movements",
    "public.sales_events",
    "supplylink_private.planning_config",
    "supplylink_private.stock_observations",
    "supplylink_private.reserve_targets",
  ])
    result[table] = (
      await db.query(
        `select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
async function recommendation(id = branch) {
  return (
    await db.query<{ r: BackupRecommendation }>(
      "select supplylink_private.backup_recommendation($1,$2) r",
      [id, product],
    )
  ).rows[0].r;
}
async function overview(user: string) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    await tx.exec("set local role authenticated");
    return (
      await tx.query<{
        r: { rows: { recommendation: BackupRecommendation }[] };
      }>("select public.stock_planning('overview','{}'::jsonb,null) r")
    ).rows[0].r;
  });
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n < migration)
    .sort())
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  for (const [id, role] of [
    [hq, "hq"],
    [buyer, "sme"],
  ]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,must_change_password) values($1,$2,$2,$3,false)",
      [id, "history." + role, role],
    );
  }
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Hlaing','Yangon')",
    [branch],
  );
  product = (
    await db.query<{ id: string }>(
      "select id from public.products where active and brand='STT' order by id limit 1",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,allocated,protected_reserve) values($1,$2,50,3,12)",
    [branch, product],
  );
  await db.query(
    "insert into supplylink_private.reserve_targets(branch_id,product_id,target,alert_threshold) values($1,$2,40,10)",
    [branch, product],
  );
  original = await operationalState();
  sql = await readFile("supabase/migrations/" + migration, "utf8");
  await db.exec(sql);
}, 30000);
afterAll(() => db.close());

it("makes recommendations available using three complete months, without modifying operational records or dates", async () => {
  const rec = await recommendation();
  expect(rec).toMatchObject({
    eligible: true,
    completeMonths: 3,
    orders: 6,
    receipts: 3,
  });
  expect(rec.quantity).toBeGreaterThan(0);
  expect(rec.monthlyVariation).toBeGreaterThan(0);
  expect(rec.leadDays).toBe(3);
  expect(await operationalState()).toEqual(original);
  const rows = (
    await db.query<{ month: string; takeover_units: number }>(
      "select month::text,takeover_units from supplylink_private.planning_history_samples where branch_id=$1 and product_id=$2 order by month",
      [branch, product],
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(rows[0].month).toBe(rec.from);
  const units = rows.map((r) => r.takeover_units);
  const mean = units.reduce((a, b) => a + b, 0) / 3;
  const variation = Math.sqrt(
    units.reduce((sum, n) => sum + (n - mean) ** 2, 0) / 3,
  );
  expect(rec.units).toBe(units.reduce((a, b) => a + b, 0));
  expect(rec.quantity).toBe(Math.ceil(mean + variation + (rec.units / 90) * 3));
});

it("keeps provenance database-only and provides consistent aggregate inputs through the protected HQ RPC", async () => {
  const data = await overview(hq);
  expect(data.rows.every((r) => r.recommendation.eligible)).toBe(true);
  expect(JSON.stringify(data)).not.toMatch(
    /synthetic|sample|three_month_backup_history/,
  );
  const rec = await recommendation();
  const row = (
    await db.query<{ r: PlanningRow[] }>(
      "select supplylink_private.planning_rows($1,date_trunc('month',now() at time zone 'Asia/Yangon')::date,20,3,5) r",
      [branch],
    )
  ).rows[0].r.find((r) => r.productId === product)!;
  expect(row).toMatchObject({
    backupUnits: rec.units,
    backupOrders: 6,
    completeMonths: 3,
    refillLeadDays: 3,
    carryover: 12,
    retailAvailable: 35,
  });
  expect(row.baseline).toBe(Math.ceil(rec.quantity! * 1.2));
  expect(
    (
      await db.query(
        "select source from supplylink_private.planning_history_sample_runs",
      )
    ).rows,
  ).toEqual([{ source: "synthetic" }]);
  expect(
    (
      await db.query(
        "select details->>'source' source from public.audit_events where action='planning.synthetic_history_seeded'",
      )
    ).rows,
  ).toEqual([{ source: "synthetic" }]);
  await expect(overview(buyer)).rejects.toThrow(/HQ/);
});

it("is idempotent and freezes the original window instead of automatically generating future history", async () => {
  const state = async () =>
    (
      await db.query(`select
    (select jsonb_agg(to_jsonb(r)) from supplylink_private.planning_history_sample_runs r) runs,
    (select count(*) from supplylink_private.planning_history_samples) samples,
    (select count(*) from public.audit_events where action='planning.synthetic_history_seeded') audits`)
    ).rows;
  const before = await state();
  await db.exec(sql);
  expect(await state()).toEqual(before);
  expect(await operationalState()).toEqual(original);
});

it("can disable all synthetic evidence without removing history or changing the genuine observation gate", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "update supplylink_private.planning_history_sample_runs set enabled=false where batch_key=$1",
      [batch],
    );
    expect(await recommendation()).toMatchObject({
      eligible: false,
      quantity: null,
      completeMonths: 0,
      orders: 0,
      receipts: 0,
    });
  } finally {
    await db.exec("rollback");
  }
});

it("does not claim coverage for missing months or unseeded branches", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "delete from supplylink_private.planning_history_samples where branch_id=$1 and product_id=$2 and month=(select min(month) from supplylink_private.planning_history_samples)",
      [branch, product],
    );
    expect(await recommendation()).toMatchObject({
      eligible: false,
      quantity: null,
      completeMonths: 2,
      orders: 4,
      receipts: 2,
    });
    const unseeded = randomUUID();
    await db.query(
      "insert into public.branches(id,name,address) values($1,'Later branch','Yangon')",
      [unseeded],
    );
    expect(await recommendation(unseeded)).toMatchObject({
      eligible: false,
      completeMonths: 0,
      orders: 0,
      receipts: 0,
    });
  } finally {
    await db.exec("rollback");
  }
});

it("adds genuine takeover evidence and weights real refill lead times by receipt count", async () => {
  const before = await recommendation();
  await db.exec("begin");
  try {
    const order = randomUUID();
    await db.query(
      `insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total)
      values($1,'STT-real',$2,'Shop','Yangon','Receiver','09123456789',9,0,0)`,
      [order, buyer],
    );
    await db.query(
      "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) values($1,$2,'STT','pairs',9,0)",
      [order, product],
    );
    await db.query(
      `insert into public.delivery_handoffs(order_id,branch_id,status,original_resolution,reason,created_by,created_at,responded_at)
      values($1,$2,'accepted','HQ consignment not dispatched','Deadline at risk',$3,$4::date+interval '9 days',$4::date+interval '9 days 1 hour')`,
      [order, branch, hq, before.from],
    );
    await db.query(
      `insert into public.stock_transfers(reference,destination_branch_id,product_id,quantity,purpose,status,reason,created_by,dispatched_at,received_at)
      values('TR-real',$1,$2,9,'backup','received','Backup refill',$3,$4::date+interval '1 day',$4::date+interval '3 days')`,
      [branch, product, hq, before.from],
    );
    expect(await recommendation()).toMatchObject({
      eligible: true,
      orders: 7,
      units: before.units + 9,
      receipts: 4,
      leadDays: 2.75,
    });
  } finally {
    await db.exec("rollback");
  }
});

it("denies raw sample reads and writes to both public and signed-in clients", async () => {
  for (const role of ["anon", "authenticated"])
    for (const statement of [
      "select * from supplylink_private.planning_history_samples",
      "update supplylink_private.planning_history_sample_runs set enabled=false",
    ])
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.exec(statement);
        }),
      ).rejects.toThrow(/permission denied/);
});
