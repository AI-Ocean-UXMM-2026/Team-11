import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";
const db = new PGlite();
const hq = randomUUID();
let product: string;
async function user(role: string, branch: string | null = null) {
  const id = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query(
    "insert into public.profiles(id,username,name,role,branch_id,must_change_password) values($1,$2,$2,$3,$4,false)",
    [id, id, role, branch],
  );
  return id;
}
async function as<T = any>(id: string, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, args)).rows;
  });
}
async function run(
  actor: string,
  action: string,
  payload: object,
  key = randomUUID(),
) {
  return (
    await as<{ r: any }>(
      actor,
      "select public.workflow_execute($1,$2::jsonb,$3::uuid) r",
      [action, JSON.stringify(payload), key],
    )
  )[0].r;
}
async function fixture() {
  const b = (
    await db.query<{ id: string }>(
      "insert into public.branches(name,address,manager_name) values($1,'Demo','Manager') returning id",
      [`Phase branch ${randomUUID()}`],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) values($1,$2,40,40)",
    [b, product],
  );
  const staff = await user("branch", b),
    driver = await user("driver", b),
    hqDriver = await user("driver"),
    sme = await user("sme");
  async function order(qty = 60) {
    const id = randomUUID();
    await db.query(
      "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,latitude,longitude) values($1,$2,$3,'Phase shop','Yangon','Receiver','+959123456789',$4,$5,5000,'Confirmed',now(),now(),16.84,96.13)",
      [id, `OPL-${id}`, sme, qty, qty * 45000],
    );
    await db.query(
      "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) select $1,id,name,pack,$3,45000 from public.products where id=$2",
      [id, product, qty],
    );
    await db.query(
      "update public.inventory set allocated=allocated+$1 where branch_id is null and product_id=$2",
      [qty, product],
    );
    return id;
  }
  return { b, staff, driver, hqDriver, sme, order };
}
async function phase(orderId: string) {
  return (
    await db.query<any>(
      "select * from supplylink_private.fulfilment_phases where order_id=$1 and state in ('requested','reserved','dispatched')",
      [orderId],
    )
  ).rows[0];
}
async function snap(actor: string, orderId: string) {
  const s = (
    await as<{ r: WorkspaceData }>(
      actor,
      "select public.workflow_snapshot(jsonb_build_object('orderId',$1::text)) r",
      [orderId],
    )
  )[0].r;
  return s.selectedOrder!;
}
async function request(
  orderId: string,
  branchId: string | null,
  quantity: number,
) {
  await run(hq, "phase_request", {
    orderId,
    branchId,
    lines: [{ productId: product, quantity }],
    reason: "Deliver available stock first",
  });
  return phase(orderId);
}
async function prepare(actor: string, orderId: string, driver: string) {
  await run(actor, "assign", { orderId, driverId: driver });
  await run(actor, "prepare", { orderId });
  return run(actor, "dispatch", { orderId });
}
async function stock(branch: string | null) {
  return (
    await db.query<{
      on_hand: number;
      allocated: number;
      protected_reserve: number;
    }>(
      "select on_hand,allocated,protected_reserve from public.inventory where branch_id is not distinct from $1 and product_id=$2",
      [branch, product],
    )
  ).rows[0];
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.query("insert into auth.users(id) values($1)", [hq]);
  await db.query(
    "insert into public.profiles(id,username,name,role,must_change_password) values($1,'phase-hq','HQ','hq',false)",
    [hq],
  );
  product = (
    await db.query<{ id: string }>(
      "select id from public.products order by id limit 1",
    )
  ).rows[0].id;
  await db.query(
    "update public.inventory set on_hand=10000 where branch_id is null",
  );
}, 30000);
afterAll(() => db.close());

it("delivers 40 of 60 from a branch, retains Order remaining throughout phase 2 and posts exactly one sale after both parties", async () => {
  const f = await fixture(),
    o = await f.order();
  const before = await stock(null);
  const p1 = await request(o, f.b, 40);
  await run(f.staff, "handoff_accept", {
    orderId: o,
    handoffId: p1.handoff_id,
  });
  expect(await stock(f.b)).toMatchObject({
    on_hand: 40,
    allocated: 40,
    protected_reserve: 0,
  });
  expect((await stock(null)).allocated).toBe(before.allocated - 40);
  await prepare(f.staff, o, f.driver);
  await run(f.driver, "pickup", { orderId: o });
  const driverOrder = await snap(f.driver, o);
  expect(driverOrder.items).toBe(40);
  expect(driverOrder.workflow!.lines[0].quantity).toBe(40);
  expect(driverOrder.workflow!.lines[0].unitPrice).toBeUndefined();
  await run(f.driver, "handover", { orderId: o, phaseId: p1.id });
  const receiptKey = randomUUID();
  const receipt = await run(
    f.sme,
    "receive",
    { orderId: o, phaseId: p1.id, fullReceipt: true },
    receiptKey,
  );
  let s = await snap(f.sme, o);
  expect(s.status).toBe("Order remaining");
  expect(s.workflow!.fulfilment).toMatchObject({
    received: 40,
    ordered: 60,
    remaining: 20,
    current: null,
  });
  const demand = (
    await db.query<{ quantity: number }>(
      "select quantity from supplylink_private.wholesale_demand_lines() where order_id=$1 and branch_id=$2",
      [o, f.b],
    )
  ).rows;
  expect(demand).toEqual([{ quantity: 40 }]);
  const detail = (
    await as<{ r: any }>(
      hq,
      "select public.stock_planning('detail',jsonb_build_object('branchId',$1::text,'productId',$2::text),null) r",
      [f.b, product],
    )
  )[0].r;
  expect(
    detail.takeovers.find((t: any) => t.id === p1.handoff_id),
  ).toMatchObject({ quantity: 40, status: "fulfilled" });
  expect(
    (await db.query("select * from public.sales_events where order_id=$1", [o]))
      .rows,
  ).toHaveLength(0);
  const p2 = await request(o, null, 20);
  s = await snap(hq, o);
  expect(s.status).toBe("Order remaining");
  expect(s.workflow!.fulfilment!.deliveryStatus).toBe("Confirmed");
  await run(hq, "assign", { orderId: o, driverId: f.hqDriver });
  await run(hq, "prepare", { orderId: o });
  expect((await snap(hq, o)).status).toBe("Order remaining");
  await run(hq, "dispatch", { orderId: o });
  s = await snap(f.sme, o);
  expect(s.status).toBe("Order remaining");
  expect(s.workflow!.fulfilment!.deliveryStatus).toBe("Shipping");
  expect(
    await run(
      f.sme,
      "receive",
      { orderId: o, phaseId: p1.id, fullReceipt: true },
      receiptKey,
    ),
  ).toEqual(receipt);
  await expect(
    run(f.sme, "receive", { orderId: o, phaseId: p1.id, fullReceipt: true }),
  ).rejects.toThrow("phase changed");
  await run(f.hqDriver, "pickup", { orderId: o });
  await run(f.sme, "receive", {
    orderId: o,
    phaseId: p2.id,
    fullReceipt: true,
  });
  expect((await snap(f.sme, o)).status).toBe("Order remaining");
  await run(f.hqDriver, "handover", { orderId: o, phaseId: p2.id });
  s = await snap(f.sme, o);
  expect(s.status).toBe("Done");
  expect(s.workflow!.fulfilment).toMatchObject({ received: 60, remaining: 0 });
  expect(s.workflow!.hqComplete).toBe(false);
  const sale = (
    await db.query<{ units: number; merchandise: string }>(
      "select units,merchandise from public.sales_events where order_id=$1",
      [o],
    )
  ).rows;
  expect(sale).toHaveLength(1);
  expect(sale[0].units).toBe(60);
  expect(Number(sale[0].merchandise)).toBe(2700000);
  expect(await stock(f.b)).toMatchObject({ on_hand: 0, allocated: 0 });
  expect((await stock(null)).on_hand).toBe(before.on_hand - 20);
  expect((await stock(null)).allocated).toBe(before.allocated - 60);
});

it("splits a returned HQ consignment into a 40-pair branch phase and a 20-pair HQ phase", async () => {
  const f = await fixture(),
    o = await f.order();
  const before = await stock(null);

  await prepare(hq, o, f.hqDriver);
  await db.query(
    "update public.orders set status='On hold',has_open_issue=true,issue_reason='HQ delivery delayed' where id=$1",
    [o],
  );
  await run(hq, "route_branch", {
    orderId: o,
    branchId: f.b,
    reason: "HQ driver unavailable; route available pairs through the branch.",
    originalResolution: "returned_to_hq",
    consignmentResolved: true,
    receivedBack: true,
  });
  const oldRequest = (
    await db.query<{ id: string }>(
      "select id from public.delivery_handoffs where order_id=$1 and status='pending'",
      [o],
    )
  ).rows[0].id;
  await run(hq, "handoff_cancel", {
    orderId: o,
    handoffId: oldRequest,
    reason: "Convert the full-order request to a stock-sized phase.",
  });

  const branchPhase = await request(o, f.b, 40);
  expect((await stock(null)).allocated).toBe(before.allocated);
  await run(f.staff, "handoff_accept", {
    orderId: o,
    handoffId: branchPhase.handoff_id,
  });
  await prepare(f.staff, o, f.driver);
  await run(f.driver, "pickup", { orderId: o });
  await run(f.driver, "handover", { orderId: o, phaseId: branchPhase.id });
  await run(f.sme, "receive", {
    orderId: o,
    phaseId: branchPhase.id,
    fullReceipt: true,
  });
  expect((await snap(f.sme, o)).workflow!.fulfilment).toMatchObject({
    ordered: 60,
    received: 40,
    remaining: 20,
    current: null,
  });

  const hqPhase = await request(o, null, 20);
  await prepare(hq, o, f.hqDriver);
  await run(f.hqDriver, "pickup", { orderId: o });
  await run(f.hqDriver, "handover", { orderId: o, phaseId: hqPhase.id });
  await run(f.sme, "receive", {
    orderId: o,
    phaseId: hqPhase.id,
    fullReceipt: true,
  });

  expect((await snap(f.sme, o)).status).toBe("Done");
  expect((await stock(null)).on_hand).toBe(before.on_hand - 20);
  expect((await stock(null)).allocated).toBe(before.allocated - 60);
  expect((await stock(f.b)).on_hand).toBe(0);
  expect(
    (await db.query("select * from public.sales_events where order_id=$1", [o]))
      .rows,
  ).toHaveLength(1);
});

it("can start a stock-sized phase directly from a held dispatched order after HQ confirms return", async () => {
  const f = await fixture(),
    o = await f.order();
  const before = await stock(null);
  await prepare(hq, o, f.hqDriver);
  await db.query(
    "update public.orders set status='On hold',has_open_issue=true,issue_reason='HQ delivery delayed' where id=$1",
    [o],
  );

  const p = await run(hq, "phase_request", {
    orderId: o,
    branchId: f.b,
    lines: [{ productId: product, quantity: 40 }],
    reason: "Branch delivers available backup first.",
    returnedConsignmentConfirmed: true,
  });
  expect((await stock(null)).on_hand).toBe(before.on_hand);
  expect((await stock(null)).allocated).toBe(before.allocated);
  const activePhase = await phase(o);
  expect(activePhase).toMatchObject({
    state: "requested",
    source_branch_id: f.b,
  });
  expect(p.message).toContain("Waiting for branch acceptance");
  await run(f.staff, "handoff_accept", {
    orderId: o,
    handoffId: activePhase.handoff_id,
  });
  expect((await stock(null)).allocated).toBe(before.allocated - 40);
  expect(await stock(f.b)).toMatchObject({ on_hand: 40, allocated: 40 });
});

it("records SME receipt first but waits for phase handover and cannot overfill or use retail stock", async () => {
  const f = await fixture(),
    o = await f.order();
  await expect(request(o, f.b, 41)).rejects.toThrow("backup stock");
  expect(await phase(o)).toBeUndefined();
  await db.query(
    "update public.inventory set on_hand=80 where branch_id=$1 and product_id=$2",
    [f.b, product],
  );
  await expect(request(o, f.b, 61)).rejects.toThrow("outstanding");
  const p = await request(o, f.b, 40);
  await run(f.staff, "handoff_accept", { orderId: o, handoffId: p.handoff_id });
  await prepare(f.staff, o, f.driver);
  await run(f.driver, "pickup", { orderId: o });
  await run(f.sme, "receive", { orderId: o, phaseId: p.id, fullReceipt: true });
  expect((await snap(f.sme, o)).workflow!.fulfilment!.received).toBe(40);
  await expect(request(o, null, 20)).rejects.toThrow("previous phase");
  await run(f.driver, "handover", { orderId: o, phaseId: p.id });
  expect((await snap(f.sme, o)).status).toBe("Order remaining");
});

it("rechecks branch stock atomically at acceptance and permits decline or reservation cancellation without losing HQ allocations", async () => {
  const f = await fixture(),
    o1 = await f.order(),
    o2 = await f.order();
  const before = await stock(null);
  const p1 = await request(o1, f.b, 40),
    p2 = await request(o2, f.b, 40);
  await run(f.staff, "handoff_accept", {
    orderId: o1,
    handoffId: p1.handoff_id,
  });
  await expect(
    run(f.staff, "handoff_accept", { orderId: o2, handoffId: p2.handoff_id }),
  ).rejects.toThrow("stock changed");
  await run(f.staff, "handoff_decline", {
    orderId: o2,
    handoffId: p2.handoff_id,
    reason: "Stock was used by another phase",
  });
  await run(hq, "phase_cancel", {
    orderId: o1,
    phaseId: p1.id,
    reason: "Replan this delivery",
  });
  expect(await stock(f.b)).toMatchObject({
    on_hand: 40,
    allocated: 0,
    protected_reserve: 40,
  });
  expect((await stock(null)).allocated).toBe(before.allocated);
  await expect(run(hq, "dispatch", { orderId: o1 })).rejects.toThrow(
    "next phase",
  );
});

it("denies foreign actors and private ledger reads, binds retries and filters the public overall status before pagination", async () => {
  const f = await fixture(),
    o = await f.order();
  const p = await request(o, f.b, 40);
  const stranger = await user("sme");
  await expect(
    run(stranger, "handoff_accept", { orderId: o, handoffId: p.handoff_id }),
  ).rejects.toThrow("unavailable");
  await expect(
    as(f.sme, "select * from supplylink_private.fulfilment_phases"),
  ).rejects.toThrow();
  await run(f.staff, "handoff_accept", { orderId: o, handoffId: p.handoff_id });
  await prepare(f.staff, o, f.driver);
  await run(f.driver, "pickup", { orderId: o });
  await run(f.driver, "handover", { orderId: o, phaseId: p.id });
  await run(f.sme, "receive", { orderId: o, phaseId: p.id, fullReceipt: true });
  const list = (
    await as<{ r: any }>(
      f.sme,
      "select public.workflow_list('orders','{\"status\":\"Order remaining\"}') r",
    )
  )[0].r;
  expect(list.total).toBe(1);
  expect(list.rows[0].status).toBe("Order remaining");
  expect(
    (
      await as<{ r: any }>(
        f.sme,
        "select public.workflow_list('orders','{\"status\":\"Shipping\"}') r",
      )
    )[0].r.total,
  ).toBe(0);
});

it("completes legacy single deliveries from handover plus SME receipt without HQ completion", async () => {
  const f = await fixture(),
    o = await f.order(2);
  await prepare(hq, o, f.hqDriver);
  await run(f.hqDriver, "pickup", { orderId: o });
  await run(f.sme, "receive", { orderId: o, fullReceipt: true });
  expect((await snap(f.sme, o)).status).toBe("Shipping");
  await run(f.hqDriver, "handover", { orderId: o });
  expect((await snap(f.sme, o)).status).toBe("Done");
  await run(hq, "complete", { orderId: o });
  expect(
    (await db.query("select * from public.sales_events where order_id=$1", [o]))
      .rows,
  ).toHaveLength(1);
});

it("keeps size and colour balances separate and refuses quantities from another variant", async () => {
  const f = await fixture(),
    o = await f.order();
  const second = (
    await db.query<{ id: string }>(
      "select id from public.products where id<>$1 limit 1",
      [product],
    )
  ).rows[0].id;
  await db.query(
    "update public.order_lines set quantity=30 where order_id=$1",
    [o],
  );
  await db.query(
    "update public.inventory set allocated=allocated-30 where branch_id is null and product_id=$1",
    [product],
  );
  await db.query(
    "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) select $1,id,name,pack,30,45000 from public.products where id=$2",
    [o, second],
  );
  await db.query(
    "update public.inventory set allocated=allocated+30 where branch_id is null and product_id=$1",
    [second],
  );
  await db.query(
    "update public.inventory set on_hand=20,protected_reserve=20 where branch_id=$1 and product_id=$2",
    [f.b, product],
  );
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) values($1,$2,10,10)",
    [f.b, second],
  );
  await expect(
    run(hq, "phase_request", {
      orderId: o,
      branchId: f.b,
      reason: "Two variant delivery",
      lines: [{ productId: product, quantity: 31 }],
    }),
  ).rejects.toThrow("outstanding");
  await run(hq, "phase_request", {
    orderId: o,
    branchId: f.b,
    reason: "Two variant delivery",
    lines: [
      { productId: product, quantity: 20 },
      { productId: second, quantity: 10 },
    ],
  });
  const p = await phase(o);
  await run(f.staff, "handoff_accept", { orderId: o, handoffId: p.handoff_id });
  await prepare(f.staff, o, f.driver);
  await run(f.driver, "pickup", { orderId: o });
  await run(f.driver, "handover", { orderId: o, phaseId: p.id });
  await run(f.sme, "receive", { orderId: o, phaseId: p.id, fullReceipt: true });
  const progress = (await snap(f.sme, o)).workflow!.fulfilment!;
  expect(progress.remaining).toBe(30);
  expect(progress.lines.find((l) => l.productId === product)).toMatchObject({
    ordered: 30,
    received: 20,
  });
  expect(progress.lines.find((l) => l.productId === second)).toMatchObject({
    ordered: 30,
    received: 10,
  });
});

it("preserves group acceptance, pickup and parcel quantities for partial phases", async () => {
  const f = await fixture(),
    orders = [await f.order(), await f.order()];
  for (const o of orders) {
    const p = await request(o, f.b, 20);
    await run(f.staff, "handoff_accept", {
      orderId: o,
      handoffId: p.handoff_id,
    });
  }
  const group = (
    await as<{ r: any }>(
      hq,
      "select public.delivery_group_assign($1::uuid[],$2::uuid,$3::uuid) r",
      [orders, f.driver, randomUUID()],
    )
  )[0].r;
  for (const o of orders) {
    await run(f.staff, "prepare", { orderId: o });
    await run(f.staff, "dispatch", { orderId: o });
  }
  await as(
    f.driver,
    "select public.driver_delivery_group_action($1::uuid,'accept','{}'::uuid[],$2::uuid)",
    [group.runId, randomUUID()],
  );
  await as(
    f.driver,
    "select public.driver_delivery_group_action($1::uuid,'pickup',$2::uuid[],$3::uuid)",
    [group.runId, orders, randomUUID()],
  );
  const groups = (
    await as<{ r: any[] }>(f.driver, "select public.driver_delivery_groups() r")
  )[0].r;
  expect(groups[0].stops.map((s: any) => s.pairs)).toEqual([20, 20]);
  expect(groups[0].stops.every((s: any) => s.pickedUpAt)).toBe(true);
  expect((await stock(f.b)).on_hand).toBe(0);
});
