import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";
import type {
  BackupPlanningDetail,
  BackupPlanningRow,
  PlanningSnapshot,
} from "../src/lib/stock-planning";
const db = new PGlite();
const users = {
  hq: randomUUID(),
  branch: randomUUID(),
  sme: randomUUID(),
  driver: randomUUID(),
};
let product: string;
async function query<T>(
  user: keyof typeof users,
  sql: string,
  args: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[user],
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<{ r: T }>(sql, args)).rows[0].r;
  });
}
const run = (
  user: keyof typeof users,
  action: string,
  payload: object,
  key = randomUUID(),
) =>
  query<Record<string, any>>(
    user,
    "select public.workflow_execute($1,$2::jsonb,$3::uuid) r",
    [action, JSON.stringify(payload), key],
  );
const snapshot = (user: keyof typeof users = "hq") =>
  query<WorkspaceData>(user, "select public.workflow_snapshot('{}'::jsonb) r");
const planning = (
  branchId: string,
  month = new Date().toISOString().slice(0, 7) + "-01",
) =>
  query<PlanningSnapshot>(
    "hq",
    "select public.stock_planning('snapshot',$1::jsonb,null) r",
    [JSON.stringify({ branchId, month })],
  );
const planAction = (
  action: string,
  branchId: string,
  extra: object = {},
  key = randomUUID(),
  user: keyof typeof users = "hq",
) =>
  query<any>(user, "select public.stock_planning($1,$2::jsonb,$3::uuid) r", [
    action,
    JSON.stringify({
      branchId,
      productId: product,
      reason: "HQ planning verification",
      ...extra,
    }),
    key,
  ]);
const detail = (branchId: string) =>
  planAction("detail", branchId) as Promise<BackupPlanningDetail>;

it("reconciles an already-dispatched HQ consignment before backup dispatch and prevents duplicate fulfillment", async () => {
  const b = await branch(20),
    original = await handoff(b, 8);
  await db.query("delete from public.delivery_handoffs where id=$1", [
    original.handoffId,
  ]);
  await db.query(
    "update public.orders set handoff_pending=false,status='Confirmed',has_open_issue=false where id=$1",
    [original.orderId],
  );
  await db.query("update public.profiles set branch_id=null where id=$1", [
    users.driver,
  ]);
  await run("hq", "assign", {
    orderId: original.orderId,
    driverId: users.driver,
  });
  await run("hq", "prepare", { orderId: original.orderId });
  await run("hq", "dispatch", { orderId: original.orderId });
  await run("hq", "hold", {
    orderId: original.orderId,
    reason: "HQ consignment confirmed lost before delivery",
  });
  const values = {
    orderId: original.orderId,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    reason: "HQ lost consignment cannot meet deadline",
  };
  await expect(planAction("takeover", b, values)).rejects.toThrow(
    /original consignment|resolved/i,
  );
  await planAction("takeover", b, {
    ...values,
    originalResolution: "lost",
    consignmentResolved: true,
  });
  const h = (await detail(b)).takeovers[0],
    before = await balance(b);
  await run("branch", "handoff_accept", {
    orderId: original.orderId,
    handoffId: h.id,
  });
  await db.query("update public.profiles set branch_id=$1 where id=$2", [
    b,
    users.driver,
  ]);
  await run("branch", "assign", {
    orderId: original.orderId,
    driverId: users.driver,
  });
  await run("branch", "prepare", { orderId: original.orderId });
  const key = randomUUID();
  await run("branch", "dispatch", { orderId: original.orderId }, key);
  await run("branch", "dispatch", { orderId: original.orderId }, key);
  expect(await balance(b)).toMatchObject({
    on_hand: before.on_hand - 8,
    protected_reserve: 12,
    retail: before.retail,
  });
  await expect(
    run("hq", "dispatch", { orderId: original.orderId }),
  ).rejects.toThrow();
  expect((await detail(b)).takeovers[0]).toMatchObject({
    status: "in transit",
    resolution: "lost",
  });
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::integer n from public.delivery_attempts where order_id=$1 and active",
        [original.orderId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("saves a manual per-SKU target, inclusive threshold and unit without history or moving stock", async () => {
  const b = await branch(16),
    before = await balance(b),
    key = randomUUID();
  const settings = {
    target: 80,
    threshold: 16,
    unit: "pairs",
    source: "manual",
  };
  await planAction("settings", b, settings, key);
  await planAction("settings", b, settings, key);
  expect(await balance(b)).toEqual(before);
  const current = (await detail(b)).row;
  expect(current).toMatchObject({
    target: 80,
    threshold: 16,
    source: "manual",
    low: true,
    available: 16,
    proposedRefill: 64,
  });
  expect(current.recommendation).toMatchObject({
    eligible: false,
    quantity: null,
  });
  await run("branch", "retail", {
    items: [{ productId: product, quantity: 1, price: 5000 }],
  });
  expect((await detail(b)).row.recommendation).toMatchObject({
    eligible: false,
    orders: 0,
    quantity: null,
  });
  await expect(
    planAction("settings", b, { ...settings, threshold: 81 }),
  ).rejects.toThrow(/threshold/);
  await expect(
    planAction("settings", b, { ...settings, source: "ai" }),
  ).rejects.toThrow(/Insufficient/);
  await expect(
    planAction("settings", b, settings, randomUUID(), "branch"),
  ).rejects.toThrow(/restricted to HQ/);
  expect(
    (await snapshot()).refillRequests!.filter(
      (r) => r.branchId === b && r.productId === product && r.pool === "backup",
    ),
  ).toHaveLength(1);
  await db.query(
    "update public.inventory set protected_reserve=17 where branch_id=$1 and product_id=$2",
    [b, product],
  );
  expect(
    (await snapshot()).refillRequests!.filter(
      (r) => r.branchId === b && r.pool === "backup",
    ),
  ).toHaveLength(0);
  await db.query(
    "update public.inventory set protected_reserve=16 where branch_id=$1 and product_id=$2",
    [b, product],
  );
  await db.query(
    "update public.inventory set protected_reserve=15 where branch_id=$1 and product_id=$2",
    [b, product],
  );
  expect(
    (await snapshot()).refillRequests!.filter(
      (r) => r.branchId === b && r.pool === "backup",
    ),
  ).toHaveLength(1);
});

it("creates one backup refill despite different retry keys and adds it only after physical receipt", async () => {
  const b = await branch(16);
  await planAction("settings", b, {
    target: 80,
    threshold: 20,
    unit: "pairs",
    source: "manual",
  });
  const first = await planAction("refill", b),
    again = await planAction("refill", b);
  expect(again.transferId).toBe(first.transferId);
  expect((await detail(b)).row).toMatchObject({
    available: 16,
    openRefills: 1,
    incoming: 0,
    proposedRefill: 64,
  });
  await planAction("dispatch_refill", b, {
    transferId: first.transferId,
    confirmed: true,
  });
  expect((await detail(b)).row).toMatchObject({ available: 16, incoming: 64 });
  // Current refill planning must still count a dispatched transfer without a
  // current arrival confirmation. Receipt is what removes it from incoming.
  await db.query(
    "insert into supplylink_private.planning_arrivals(transfer_id,due,reason,actor_id) values($1,(now() at time zone 'Asia/Yangon')::date-1,'Arrival delayed',$2)",
    [first.transferId, users.hq],
  );
  expect((await detail(b)).row).toMatchObject({
    available: 16,
    incoming: 64,
    proposedRefill: 0,
  });
  const retailBefore = (await balance(b)).retail;
  const receiptKey = randomUUID();
  await run(
    "branch",
    "transfer_receive",
    { transferId: first.transferId, confirmed: true },
    receiptKey,
  );
  await run(
    "branch",
    "transfer_receive",
    { transferId: first.transferId, confirmed: true },
    receiptKey,
  );
  expect((await detail(b)).row).toMatchObject({
    available: 80,
    incoming: 0,
    openRefills: 0,
    low: false,
  });
  expect((await balance(b)).retail).toBe(retailBefore);
});

it("records original order deadline, reason, actor and units; acceptance reserves only backup and cancellation restores it", async () => {
  const b = await branch(16),
    original = await handoff(b, 8);
  await db.query("delete from public.delivery_handoffs where id=$1", [
    original.handoffId,
  ]);
  await db.query(
    "update public.orders set handoff_pending=false,status='Confirmed',has_open_issue=false where id=$1",
    [original.orderId],
  );
  const before = await balance(b),
    key = randomUUID(),
    deadline = new Date(Date.now() + 86400000).toISOString();
  const payload = {
    orderId: original.orderId,
    deadline,
    reason: "HQ vehicle breakdown prevents original deadline",
  };
  await planAction("takeover", b, payload, key);
  await planAction("takeover", b, payload, key);
  let history = (await detail(b)).takeovers;
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    orderId: original.orderId,
    quantity: 8,
    unit: "pairs",
    status: "pending",
    reason: payload.reason,
    fulfilledAt: null,
  });
  expect(new Date(history[0].deadline!).toISOString()).toBe(deadline);
  expect(history[0].actor).toBeTruthy();
  expect(await balance(b)).toEqual(before);
  const acceptKey = randomUUID();
  await run(
    "branch",
    "handoff_accept",
    { orderId: original.orderId, handoffId: history[0].id },
    acceptKey,
  );
  await run(
    "branch",
    "handoff_accept",
    { orderId: original.orderId, handoffId: history[0].id },
    acceptKey,
  );
  expect(await balance(b)).toMatchObject({
    protected_reserve: 8,
    allocated: 8,
    on_hand: 100,
    retail: before.retail,
  });
  expect((await detail(b)).row.reserved).toBe(8);
  await expect(planAction("takeover", b, payload)).rejects.toThrow();
  await run("hq", "cancel", {
    orderId: original.orderId,
    reason: "Customer cancelled original order",
  });
  expect(await balance(b)).toEqual(before);
  history = (await detail(b)).takeovers;
  expect(history[0].status).toBe("cancelled");
  expect(history[0].events.some((e) => e.action === "cancel")).toBe(true);
});

it("requires observed emergency history and backup lead time; applying a supported recommendation never moves stock", async () => {
  const b = await branch(16),
    before = await balance(b);
  await db.query(
    "update public.branches set created_at=now()-interval '1 year' where id=$1",
    [b],
  );
  await db.query(
    "update public.products set created_at=now()-interval '1 year' where id=$1",
    [product],
  );
  await db.exec(
    "update supplylink_private.planning_config set observed_since=now()-interval '1 year'",
  );
  await db.query(
    "update supplylink_private.stock_observations set observed_at=now()-interval '1 year' where branch_id=$1 and product_id=$2",
    [b, product],
  );
  for (let n = 0; n < 5; n++) {
    const record = await handoff(b, 12);
    await db.query(
      "update public.delivery_handoffs set status='accepted',responded_at=date_trunc('month',now())-interval '1 month',created_at=date_trunc('month',now())-($2::text||' months')::interval where id=$1",
      [record.handoffId, n < 3 ? 1 : 2],
    );
  }
  expect((await detail(b)).row.recommendation).toMatchObject({
    orders: 5,
    units: 60,
    eligible: false,
    quantity: null,
  });
  await db.query(
    "insert into public.stock_transfers(reference,destination_branch_id,product_id,quantity,status,purpose,reason,created_by,dispatched_at,received_at) values($1,$2,$3,40,'received','backup','Historical backup refill',$4,date_trunc('month',now())-interval '10 days',date_trunc('month',now())-interval '8 days')",
    [randomUUID(), b, product, users.hq],
  );
  const rec = (await detail(b)).row.recommendation;
  expect(rec).toMatchObject({
    eligible: true,
    completeMonths: 3,
    orders: 5,
    units: 60,
    receipts: 1,
    leadDays: 2,
  });
  expect(rec.quantity).toBe(
    Math.ceil(20 + Math.sqrt((16 * 16 + 4 * 4 + 20 * 20) / 3) + (60 / 90) * 2),
  );
  await planAction("settings", b, {
    target: rec.quantity,
    threshold: 10,
    unit: "pairs",
    source: "ai",
  });
  expect((await detail(b)).row.source).toBe("ai");
  expect(await balance(b)).toEqual(before);
  await expect(
    planAction("settings", b, {
      target: rec.quantity! + 1,
      threshold: 10,
      unit: "pairs",
      source: "ai",
    }),
  ).rejects.toThrow(/changed evidence/);
  const overview = await planAction("overview", b);
  expect(
    (overview.rows as BackupPlanningRow[]).find(
      (r) => r.branchId === b && r.productId === product,
    )?.source,
  ).toBe("ai");
});
it("limits branch physical stock records to stock additions already received", async () => {
  const b = await branch();
  await db.query(
    "insert into public.inventory_movements(product_id,branch_id,actor_id,kind,quantity,reason) values($1,$2,$3,'transfer_in',12,'HQ transfer received'),($1,$2,$3,'physical_in_backup',4,'Backup received'),($1,$2,$3,'retail',-2,'Retail sale'),($1,$2,$3,'transfer_out',-3,'Transfer sent')",
    [product, b, users.branch],
  );
  const history = await query<any>(
    "branch",
    "select public.branch_stock_movement_history($1::uuid,1,25) r",
    [b],
  );
  expect(history.total).toBe(2);
  expect(history.rows.map((row: { kind: string }) => row.kind).sort()).toEqual([
    "physical_in_backup",
    "transfer_in",
  ]);
  const permission = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','public.record_branch_stock_movement(uuid,uuid,text,text,integer,text,uuid)','execute') allowed",
  );
  expect(permission.rows[0].allowed).toBe(false);
});
async function branch(backup = 16) {
  const id = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address) values($1::uuid,'Pool '||($1::uuid)::text,'Yangon')",
    [id],
  );
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) values($1,$2,100,$3)",
    [id, product, backup],
  );
  await db.query("update public.profiles set branch_id=$1 where id=$2", [
    id,
    users.branch,
  ]);
  return id;
}
async function balance(branchId: string) {
  return (
    await db.query<{
      on_hand: number;
      allocated: number;
      protected_reserve: number;
      retail: number;
    }>(
      "select on_hand,allocated,protected_reserve,on_hand-allocated-protected_reserve retail from public.inventory where branch_id=$1 and product_id=$2",
      [branchId, product],
    )
  ).rows[0];
}
async function handoff(branchId: string, quantity = 8) {
  const orderId = randomUUID(),
    handoffId = randomUUID();
  await db.query(
    "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,handoff_pending,has_open_issue) values($1::uuid,($1::uuid)::text,$2,'Shop','Yangon','Receiver','09123456789',$3,1000,0,'On hold',now(),now(),true,true)",
    [orderId, users.sme, quantity],
  );
  await db.query(
    "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) values($1,$2,'STT','Black 38',$3,100)",
    [orderId, product, quantity],
  );
  await db.query(
    "update public.inventory set allocated=allocated+$1 where branch_id is null and product_id=$2",
    [quantity, product],
  );
  await db.query(
    "insert into public.delivery_handoffs(id,order_id,branch_id,original_resolution,reason,created_by) values($1,$2,$3,'Not dispatched','HQ delivery deadline at risk',$4)",
    [handoffId, orderId, branchId, users.hq],
  );
  return { orderId, handoffId };
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  product = (
    await db.query<{ id: string }>(
      "select id from public.products where brand='STT' and active limit 1",
    )
  ).rows[0].id;
  await db.query(
    "update public.inventory set on_hand=1000,allocated=0,protected_reserve=0 where branch_id is null and product_id=$1",
    [product],
  );
  const staffBranch = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Staff branch','Yangon')",
    [staffBranch],
  );
  for (const [role, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,branch_id,must_change_password) values($1,$2,$2,$3,$4,false)",
      [id, "pools." + role, role, role === "branch" ? staffBranch : null],
    );
  }
});
afterAll(() => db.close());
it("allows an immediate manual backup target without history, moves only explicit retail pairs, and handles retries once", async () => {
  const b = await branch();
  const key = randomUUID(),
    payload = {
      branchId: b,
      productId: product,
      target: 80,
      retailMove: 4,
      reason: "Initial HQ emergency reserve",
    };
  await run("hq", "backup_configure", payload, key);
  await run("hq", "backup_configure", payload, key);
  expect(await balance(b)).toMatchObject({
    on_hand: 100,
    allocated: 0,
    protected_reserve: 20,
    retail: 80,
  });
  expect(
    (await planning(b)).current.find((r) => r.productId === product),
  ).toMatchObject({ baseline: null, configuredTarget: 80 });
  expect(
    (await snapshot()).refillRequests!.find(
      (r) => r.branchId === b && r.pool === "backup",
    ),
  ).toMatchObject({ onHand: 20, threshold: 80 });
  await expect(
    run("hq", "backup_configure", { ...payload, target: 70 }, key),
  ).rejects.toThrow(/retry key/i);
  for (const role of ["branch", "sme", "driver"] as const)
    await expect(run(role, "backup_configure", payload)).rejects.toThrow(
      /Only HQ/,
    );
  await expect(
    run("hq", "backup_configure", { ...payload, retailMove: 100 }),
  ).rejects.toThrow(/explicit retail/);
  const audit = await db.query<{ n: number }>(
    "select count(*)::integer n from public.audit_events where action='backup_configure' and subject_id=$1",
    [b],
  );
  expect(audit.rows[0].n).toBe(1);
});
it("rejects a wholesale takeover when backup is insufficient even with plenty of retail stock", async () => {
  const b = await branch(4),
    payload = await handoff(b, 8),
    before = await balance(b);
  await expect(run("branch", "handoff_accept", payload)).rejects.toThrow(
    /Insufficient wholesale backup stock/,
  );
  expect(await balance(b)).toEqual(before);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.delivery_handoffs where id=$1",
        [payload.handoffId],
      )
    ).rows[0].status,
  ).toBe("pending");
});
it("allocates only backup pairs, leaves retail unchanged, and restores backup on cancellation exactly once", async () => {
  const b = await branch(),
    payload = await handoff(b, 8),
    key = randomUUID();
  await run("hq", "backup_configure", {
    branchId: b,
    productId: product,
    target: 16,
    retailMove: 0,
    reason: "Keep emergency reserve",
  });
  await run("branch", "handoff_accept", payload, key);
  await run("branch", "handoff_accept", payload, key);
  expect(await balance(b)).toMatchObject({
    on_hand: 100,
    allocated: 8,
    protected_reserve: 8,
    retail: 84,
  });
  expect(
    (await snapshot()).refillRequests!.find(
      (r) => r.branchId === b && r.pool === "backup",
    ),
  ).toMatchObject({ onHand: 8, threshold: 16 });
  const rows = (await snapshot()).branches.find((x) => x.id === b)!.inventory!;
  expect(rows.find((x) => x.productId === product)?.backupAllocated).toBe(8);
  const cancelKey = randomUUID();
  await run(
    "hq",
    "cancel",
    { orderId: payload.orderId, reason: "Customer cancellation" },
    cancelKey,
  );
  await run(
    "hq",
    "cancel",
    { orderId: payload.orderId, reason: "Customer cancellation" },
    cancelKey,
  );
  expect(await balance(b)).toMatchObject({
    on_hand: 100,
    allocated: 0,
    protected_reserve: 16,
    retail: 84,
  });
  expect(
    (await snapshot()).refillRequests!.some(
      (r) => r.branchId === b && r.pool === "backup",
    ),
  ).toBe(false);
});
it("blocks retail sales from consuming backup and keeps retail and backup receipts in their selected pools", async () => {
  const b = await branch(80);
  await expect(
    run("branch", "retail", {
      items: [{ productId: product, quantity: 21, price: 5000 }],
    }),
  ).rejects.toThrow(/available stock/);
  for (const purpose of ["retail", "backup"]) {
    const before = await balance(b),
      t = await run("hq", "transfer_create", {
        destinationBranchId: b,
        productId: product,
        quantity: 5,
        purpose,
        reason: "Selected pool refill",
      });
    await run("hq", "transfer_dispatch", {
      transferId: t.transferId,
      confirmed: true,
    });
    expect(await balance(b)).toEqual(before);
    const key = randomUUID();
    await run(
      "branch",
      "transfer_receive",
      { transferId: t.transferId, confirmed: true },
      key,
    );
    await run(
      "branch",
      "transfer_receive",
      { transferId: t.transferId, confirmed: true },
      key,
    );
    const after = await balance(b);
    expect(after.on_hand).toBe(before.on_hand + 5);
    expect(after.protected_reserve).toBe(
      before.protected_reserve + (purpose === "backup" ? 5 : 0),
    );
    expect(after.retail).toBe(before.retail + (purpose === "retail" ? 5 : 0));
  }
});

it("dispatches committed backup pairs without reducing the retail pool", async () => {
  const b = await branch(),
    payload = await handoff(b, 8);
  await run("branch", "handoff_accept", payload);
  await db.query("update public.profiles set branch_id=$1 where id=$2", [
    b,
    users.driver,
  ]);
  await run("branch", "assign", {
    orderId: payload.orderId,
    driverId: users.driver,
  });
  await run("branch", "prepare", { orderId: payload.orderId });
  await run("branch", "dispatch", { orderId: payload.orderId });
  expect(await balance(b)).toMatchObject({
    on_hand: 92,
    allocated: 0,
    protected_reserve: 8,
    retail: 84,
  });
  const ledger = await db.query<{ n: number }>(
    "select count(*)::integer n from supplylink_private.branch_backup_allocations where order_id=$1",
    [payload.orderId],
  );
  expect(ledger.rows[0].n).toBe(0);
  const movement = await db.query<{ branch_id: string; quantity: number }>(
    "select branch_id,quantity from public.inventory_movements where order_id=$1 and kind='dispatch'",
    [payload.orderId],
  );
  expect(movement.rows).toEqual([{ branch_id: b, quantity: -8 }]);
});

it("returns the first branch's committed pairs to backup when another branch takes over before dispatch", async () => {
  const first = await branch(),
    payload = await handoff(first, 8);
  await run("branch", "handoff_accept", payload);
  await run("branch", "prepare", { orderId: payload.orderId });
  await run("hq", "hold", {
    orderId: payload.orderId,
    reason: "First branch delivery deadline at risk",
  });
  const second = await branch();
  await run("hq", "route_branch", {
    orderId: payload.orderId,
    branchId: second,
    reason: "Second branch emergency takeover",
  });
  const pending = (
    await db.query<{ id: string }>(
      "select id from public.delivery_handoffs where order_id=$1 and status='pending'",
      [payload.orderId],
    )
  ).rows[0];
  await run("branch", "handoff_accept", {
    orderId: payload.orderId,
    handoffId: pending.id,
  });
  expect(await balance(first)).toMatchObject({
    on_hand: 100,
    allocated: 0,
    protected_reserve: 16,
    retail: 84,
  });
  expect(await balance(second)).toMatchObject({
    on_hand: 100,
    allocated: 8,
    protected_reserve: 8,
    retail: 84,
  });
});
it("returns only the selected branch stock pool and restores a cancelled backup return", async () => {
  const b = await branch(80);
  await expect(
    run("hq", "transfer_create", {
      sourceBranchId: b,
      productId: product,
      quantity: 21,
      purpose: "retail",
      reason: "Retail return",
    }),
  ).rejects.toThrow(/selected pool/);
  const t = await run("hq", "transfer_create", {
    sourceBranchId: b,
    productId: product,
    quantity: 10,
    purpose: "backup",
    reason: "Backup return",
  });
  expect(await balance(b)).toMatchObject({
    protected_reserve: 70,
    allocated: 10,
    retail: 20,
  });
  await run("hq", "transfer_cancel", {
    transferId: t.transferId,
    reason: "Keep backup at branch",
  });
  expect(await balance(b)).toMatchObject({
    protected_reserve: 80,
    allocated: 0,
    retail: 20,
  });
});
it("counts only explicitly labelled backup transfers in backup planning and backup alerts", async () => {
  const b = await branch(0);
  await run("hq", "backup_configure", {
    branchId: b,
    productId: product,
    target: 10,
    retailMove: 0,
    reason: "Initial target",
  });
  const month = new Date().toISOString().slice(0, 7) + "-01",
    due = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Yangon",
    }).format(new Date());
  for (const purpose of ["retail", "backup"]) {
    const t = await run("hq", "transfer_create", {
      destinationBranchId: b,
      productId: product,
      quantity: 5,
      purpose,
      reason: "Pool planning test",
    });
    await run("hq", "transfer_dispatch", {
      transferId: t.transferId,
      confirmed: true,
    });
    if (purpose === "retail")
      await expect(
        query(
          "hq",
          "select public.stock_planning('arrival',$1::jsonb,$2::uuid) r",
          [
            JSON.stringify({
              transferId: t.transferId,
              due,
              reason: "Expected today",
            }),
            randomUUID(),
          ],
        ),
      ).rejects.toThrow(/Only a wholesale backup refill/);
    else
      await query(
        "hq",
        "select public.stock_planning('arrival',$1::jsonb,$2::uuid) r",
        [
          JSON.stringify({
            transferId: t.transferId,
            due,
            reason: "Expected today",
          }),
          randomUUID(),
        ],
      );
  }
  const future = new Date();
  future.setUTCMonth(future.getUTCMonth() + 1);
  future.setUTCDate(1);
  const planned = await planning(b, future.toISOString().slice(0, 10));
  expect(planned.current.find((r) => r.productId === product)!.incoming).toBe(
    5,
  );
  expect(planned.incoming).toHaveLength(1);
  expect(
    (await snapshot()).refillRequests!.find(
      (r) => r.branchId === b && r.pool === "backup",
    )!.incoming,
  ).toBe(5);
});

it("prevents clients from bypassing stock-pool rules through obsolete private helpers", async () => {
  await expect(
    query(
      "branch",
      "select supplylink_private.workflow_with_planning('handoff_accept','{}',gen_random_uuid()) r",
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    query(
      "hq",
      "select supplylink_private.stock_planning('snapshot','{}',null) r",
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    query("hq", "select * from supplylink_private.branch_backup_allocations"),
  ).rejects.toThrow(/permission denied/);
});
