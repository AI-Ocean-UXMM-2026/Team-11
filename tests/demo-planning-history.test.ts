import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import { seedDemoPlanningHistory } from "../src/lib/workflow/demo-planning-history";
import type { BackupRecommendation } from "../src/lib/stock-planning";
const db = new PGlite();
const hq = randomUUID(),
  buyer = randomUUID(),
  branch = randomUUID(),
  existingOrder = randomUUID();
let product: string;
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  await db.exec(
    "create table public.workflow_migrations(name text primary key)",
  );
  for (const [id, role] of [
    [hq, "hq"],
    [buyer, "sme"],
  ]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,must_change_password) values($1,'planning.'||$2::text,'Planning '||$2::text,$2::public.portal_role,false)",
      [id, role],
    );
  }
  product = (
    await db.query<{ id: string }>(
      "select id from public.products where active and brand='STT' order by id limit 1",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Bahan','Yangon')",
    [branch],
  );
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,allocated,protected_reserve) values($1,$2,100,4,16)",
    [branch, product],
  );
  await db.query(
    "insert into supplylink_private.reserve_targets(branch_id,product_id,target,alert_threshold,stock_unit) values($1,$2,40,5,'pairs')",
    [branch, product],
  );
  await db.query(
    "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total) values($1,'STT-existing',$2,'Shop','Yangon','Receiver','09123456789',1,100,0)",
    [existingOrder, buyer],
  );
});
afterAll(() => db.close());
afterEach(() => vi.unstubAllEnvs());
it("seeds sufficient dated takeover/refill evidence without changing balances, settings or existing orders, and is repeatable", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
  const balance = async () =>
    (
      await db.query(
        "select on_hand,allocated,protected_reserve from public.inventory where branch_id=$1 and product_id=$2",
        [branch, product],
      )
    ).rows[0];
  const before = await balance();
  await db.transaction((tx) => seedDemoPlanningHistory(tx));
  const rec = (
    await db.query<{ r: BackupRecommendation }>(
      "select supplylink_private.backup_recommendation($1,$2) r",
      [branch, product],
    )
  ).rows[0].r;
  expect(rec).toMatchObject({
    eligible: true,
    completeMonths: 3,
    orders: 6,
    receipts: 3,
  });
  expect(rec.quantity).toBeGreaterThan(0);
  expect(rec.leadDays).toBeGreaterThan(0);
  expect(await balance()).toEqual(before);
  expect(
    (
      await db.query(
        "select target,alert_threshold,stock_unit,plan_source from supplylink_private.reserve_targets where branch_id=$1 and product_id=$2",
        [branch, product],
      )
    ).rows[0],
  ).toEqual({
    target: 40,
    alert_threshold: 5,
    stock_unit: "pairs",
    plan_source: "manual",
  });
  expect(
    (
      await db.query("select reference,status from public.orders where id=$1", [
        existingOrder,
      ])
    ).rows[0],
  ).toEqual({ reference: "STT-existing", status: "Draft" });
  const counts = async () =>
    (
      await db.query(
        "select (select count(*) from public.orders) orders,(select count(*) from public.stock_transfers) transfers,(select count(*) from public.order_events) events,(select count(*) from supplylink_private.stock_observations) observations",
      )
    ).rows[0];
  const seeded = await counts();
  await db.transaction((tx) => seedDemoPlanningHistory(tx));
  expect(await counts()).toEqual(seeded);
  expect(
    (
      await db.query(
        "select details from public.audit_events where action='local.planning_history'",
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select reference,reason from public.stock_transfers where purpose='backup'",
      )
    ).rows.every((r) => !/mock|sample|demo/i.test(JSON.stringify(r))),
  ).toBe(true);
});
it("does nothing when hosted mode is selected", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  const query = vi.fn();
  await seedDemoPlanningHistory({ query } as never);
  expect(query).not.toHaveBeenCalled();
});
