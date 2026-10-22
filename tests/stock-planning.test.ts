import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import { businessDate } from "../src/lib/domain";
import {
  nextPlanningMonth,
  explanationInput,
  type PlanningSnapshot,
  type StockPlan,
} from "../src/lib/stock-planning";
const db = new PGlite();
const users = {
  hq: randomUUID(),
  sme: randomUUID(),
  driver: randomUUID(),
  branch: randomUUID(),
  suspended: randomUUID(),
  pending: randomUUID(),
};
let products: { id: string }[];
const month = businessDate(new Date().toISOString()).slice(0, 7) + "-01";
async function rpc(
  action: string,
  payload: object,
  user: keyof typeof users = "hq",
  key: string | null = randomUUID(),
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[user],
    ]);
    await tx.exec("set local role authenticated");
    return (
      await tx.query<{ r: any }>(
        "select public.stock_planning($1,$2::jsonb,$3::uuid) r",
        [action, JSON.stringify(payload), key],
      )
    ).rows[0].r;
  });
}
async function branch() {
  const id = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address) values($1,$2,'Yangon')",
    [id, `Planning ${id}`],
  );
  for (const p of products)
    await db.query(
      "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) values($1,$2,100,16)",
      [id, p.id],
    );
  return id;
}
const overrides = (target = 80, move = 0) =>
  products.map((p) => ({
    productId: p.id,
    target,
    retailMove: move,
    reason: "Initial HQ manual target",
  }));
async function generate(branchId: string, extra: object = {}) {
  return rpc("generate", {
    branchId,
    month,
    overrides: overrides(),
    ...extra,
  }) as Promise<StockPlan>;
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  const staffBranch = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Staff branch','Yangon')",
    [staffBranch],
  );
  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,status,must_change_password,branch_id) values($1,$2,$2,$3,$4,$5,$6)",
      [
        id,
        `planning.${name}`,
        ["pending", "suspended"].includes(name) ? "hq" : name,
        name === "suspended" ? "suspended" : "active",
        name === "pending",
        name === "branch" ? staffBranch : null,
      ],
    );
  }
  products = (
    await db.query<{ id: string }>(
      "select id from public.products where active order by id",
    )
  ).rows;
}, 30000);
afterAll(async () => {
  await db.close();
});

it("uses carryover per SKU: 80 target less 16 leftover requires 64, with no stock change before approval", async () => {
  const b = await branch();
  const plan = await generate(b);
  expect(plan.rows).toHaveLength(6);
  expect(
    plan.rows.every((r) => r.target === 80 && r.refill === 64 && r.manual),
  ).toBe(true);
  expect(
    (
      await db.query<{ p: number }>(
        "select sum(protected_reserve)::int p from public.inventory where branch_id=$1",
        [b],
      )
    ).rows[0].p,
  ).toBe(96);
  expect(
    (await generate(b, { overrides: overrides(10) })).rows.every(
      (r) => r.refill === 0,
    ),
  ).toBe(true);
});
it("requires manual targets with insufficient history and preserves an honest unresolved state", async () => {
  const b = await branch();
  const p = await generate(b, { overrides: [] });
  expect(
    p.rows.every(
      (r) => r.baseline === null && r.target === null && r.refill === null,
    ),
  ).toBe(true);
  await expect(
    rpc("approve", { planId: p.id, reason: "Reviewed quantities" }),
  ).rejects.toThrow(/manual targets/);
  await expect(
    generate(b, { overrides: overrides().map((r) => ({ ...r, reason: "" })) }),
  ).rejects.toThrow(/Explain/);
});
it("approves only explicit retail reallocation, preserves physical stock/allocations, audits and handles retries once", async () => {
  const b = await branch();
  await db.query("update public.inventory set allocated=4 where branch_id=$1", [
    b,
  ]);
  const p = await generate(b, { overrides: overrides(80, 10) });
  const key = randomUUID(),
    payload = {
      planId: p.id,
      reason: "Keep retail availability while protecting backup",
    };
  const approved = await rpc("approve", payload, "hq", key);
  expect(approved.status).toBe("approved");
  expect(await rpc("approve", payload, "hq", key)).toEqual(approved);
  expect(
    (
      await db.query(
        "select distinct on_hand,allocated,protected_reserve from public.inventory where branch_id=$1",
        [b],
      )
    ).rows,
  ).toEqual([{ on_hand: 100, allocated: 4, protected_reserve: 26 }]);
  expect(
    (
      await db.query(
        "select * from public.audit_events where action='planning.approve' and subject_id=$1",
        [p.id],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    rpc("approve", { ...payload, reason: "Different details" }, "hq", key),
  ).rejects.toThrow(/Retry key/);
});
it("rejects stale drafts, older versions, excess reallocation and premature month-end finalization", async () => {
  const b = await branch();
  const p = await generate(b);
  await db.query("update public.inventory set allocated=1 where branch_id=$1", [
    b,
  ]);
  await expect(
    rpc("approve", { planId: p.id, reason: "Reviewed" }),
  ).rejects.toThrow(/changed/);
  await generate(b);
  await expect(
    rpc("approve", { planId: p.id, reason: "Reviewed" }),
  ).rejects.toThrow(/latest draft/);
  await expect(generate(b, { overrides: overrides(80, 90) })).rejects.toThrow(
    /reallocation/,
  );
  const far = new Date(`${month}T00:00:00Z`);
  far.setUTCMonth(far.getUTCMonth() + 2);
  const future = await generate(b, { month: far.toISOString().slice(0, 10) });
  await expect(
    rpc("approve", { planId: future.id, reason: "Reviewed" }),
  ).rejects.toThrow(/month-end/);
});
it("deducts confirmed incoming only once, excludes overdue/reserved transfers and invalidates drafts on receipt", async () => {
  const b = await branch(),
    transfer = randomUUID(),
    next = nextPlanningMonth();
  await db.query(
    "insert into public.stock_transfers(id,reference,destination_branch_id,product_id,quantity,status,reason,created_by,dispatched_at,purpose) values($1::uuid,$1::text,$2,$3,10,'shipping','Refill',$4,now(),'backup')",
    [transfer, b, products[0].id, users.hq],
  );
  const before = await generate(b, { month: next });
  expect(before.rows.find((r) => r.productId === products[0].id)!.refill).toBe(
    64,
  );
  await rpc("arrival", {
    transferId: transfer,
    due: next,
    reason: "Delivery confirmed with driver",
  });
  const plan = await generate(b, { month: next });
  expect(plan.rows.find((r) => r.productId === products[0].id)!.incoming).toBe(
    10,
  );
  expect(plan.rows.find((r) => r.productId === products[0].id)!.refill).toBe(
    54,
  );
  await db.query(
    "update public.stock_transfers set status='received',received_at=now() where id=$1",
    [transfer],
  );
  const snapshot: PlanningSnapshot = await rpc("snapshot", {
    branchId: b,
    month: next,
  });
  expect(
    snapshot.current.find((r) => r.productId === products[0].id)!.incoming,
  ).toBe(0);
});
it("denies non-HQ, first-login, suspended, anonymous and direct table/explanation writes", async () => {
  const b = await branch();
  for (const user of [
    "sme",
    "driver",
    "branch",
    "pending",
    "suspended",
  ] as const)
    await expect(
      rpc("snapshot", { branchId: b, month }, user),
    ).rejects.toThrow();
  await db.exec("set role anon");
  await expect(
    db.query("select public.stock_planning('snapshot','{}',null)"),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role; set role authenticated");
  await expect(
    db.query("select * from supplylink_private.stock_plans"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("select public.planning_store_explanation(null,null,null,'{}')"),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
});
it("claims explanations once, caches results and exposes only aggregate anonymous SKU facts to the model", async () => {
  const p = await generate(await branch());
  const claim = await rpc("claim_explanation", { planId: p.id });
  expect(claim.cached).toBe(false);
  expect((await rpc("claim_explanation", { planId: p.id })).cached).toBe(true);
  await db.query(
    "select public.planning_store_explanation($1,$2,$3,$4::jsonb)",
    [
      p.id,
      users.hq,
      claim.token,
      JSON.stringify({ status: "ready", summary: "Saved explanation" }),
    ],
  );
  expect(
    (await rpc("claim_explanation", { planId: p.id })).plan.explanation.summary,
  ).toBe("Saved explanation");
  const serialized = JSON.stringify(explanationInput(p));
  expect(serialized).not.toContain(p.id);
  expect(serialized).not.toContain(p.branchId);
  expect(serialized).not.toContain("Initial HQ manual target");
});
it("captures structured stock-shortage declines and unmet baskets without duplicating demand", async () => {
  const staff = (
    await db.query<{ branch_id: string }>(
      "select branch_id from public.profiles where id=$1",
      [users.branch],
    )
  ).rows[0].branch_id;
  const order = randomUUID(),
    handoff = randomUUID();
  await db.query(
    "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,has_open_issue,handoff_pending) values($1::uuid,$1::text,$2,'Shop','Yangon','Receiver','09123456789',10,100,0,'On hold',now(),now(),true,true)",
    [order, users.sme],
  );
  await db.query(
    "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) values($1,$2,'Sneaker','40 Black',10,10)",
    [order, products[0].id],
  );
  await db.query(
    "insert into public.delivery_handoffs(id,order_id,branch_id,status,original_resolution,reason,created_by) values($1,$2,$3,'pending','Resolved','Backup needed',$4)",
    [handoff, order, staff, users.hq],
  );
  await expect(
    rpc("unmet", { orderId: order, reason: "No branch has the basket" }),
  ).rejects.toThrow(/current branch request/);
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users.branch,
    ]);
    await tx.exec("set local role authenticated");
    const payload = {
      orderId: order,
      handoffId: handoff,
      reason: "Missing this size",
      declineCause: "stock_shortage",
    };
    const key = randomUUID();
    await tx.query(
      "select public.workflow_execute('handoff_decline',$1::jsonb,$2::uuid)",
      [JSON.stringify(payload), key],
    );
    await tx.query(
      "select public.workflow_execute('handoff_decline',$1::jsonb,$2::uuid)",
      [JSON.stringify(payload), key],
    );
  });
  expect(
    (
      await db.query(
        "select cause from supplylink_private.backup_declines where handoff_id=$1",
        [handoff],
      )
    ).rows,
  ).toEqual([{ cause: "stock_shortage" }]);
  const payload = {
      orderId: order,
      reason: "No suitable branch can provide the basket",
    },
    key = randomUUID();
  await rpc("unmet", payload, "hq", key);
  await rpc("unmet", payload, "hq", key);
  expect(
    (
      await db.query(
        "select * from supplylink_private.backup_unmet where order_id=$1",
        [order],
      )
    ).rows,
  ).toHaveLength(1);
  const snapshot: PlanningSnapshot = await rpc("snapshot", {
    branchId: staff,
    month,
  });
  expect(snapshot.unmet.find((u) => u.orderId === order)?.units).toBe(10);
  expect(
    snapshot.current.find((r) => r.productId === products[0].id)!.backupUnits,
  ).toBe(0); // Current month is incomplete.
});
it("records allocation and protected-stock changes and keeps approved history when releasing excess reserve", async () => {
  const b = await branch();
  const first = await generate(b);
  await rpc("approve", { planId: first.id, reason: "Initial plan reviewed" });
  const second = await generate(b, { overrides: overrides(5) });
  await rpc("approve", {
    planId: second.id,
    reason: "Lower reserve after review",
  });
  const snapshot: PlanningSnapshot = await rpc("snapshot", {
    branchId: b,
    month,
  });
  expect(snapshot.plans.map((p) => p.status)).toEqual([
    "approved",
    "superseded",
  ]);
  expect(
    (
      await db.query<{ protected_reserve: number }>(
        "select protected_reserve from public.inventory where branch_id=$1",
        [b],
      )
    ).rows.every((i) => i.protected_reserve === 5),
  ).toBe(true);
  const before = (
    await db.query<{ count: number }>(
      "select count(*)::int count from supplylink_private.stock_observations where branch_id=$1",
      [b],
    )
  ).rows[0].count;
  await db.query(
    "update public.inventory set allocated=allocated+1 where branch_id=$1",
    [b],
  );
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from supplylink_private.stock_observations where branch_id=$1",
        [b],
      )
    ).rows[0].count,
  ).toBe(before + 6);
});
it("withholds a monthly recommendation without refill lead-time evidence and counts one order across branch candidates", async () => {
  const b = await branch(),
    other = await branch();
  await db.query(
    "update public.branches set created_at=now()-interval '1 year' where id in ($1,$2)",
    [b, other],
  );
  await db.exec(
    "update public.products set created_at=now()-interval '1 year'; update supplylink_private.planning_config set observed_since=now()-interval '1 year'",
  );
  await db.query(
    "update supplylink_private.stock_observations set observed_at=now()-interval '1 year' where branch_id in ($1,$2)",
    [b, other],
  );
  for (let n = 0; n < 5; n++) {
    const order = randomUUID();
    await db.query(
      "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total) values($1::uuid,$1::text,$2,'Shop','Yangon','Receiver','09123456789',10,100,0)",
      [order, users.sme],
    );
    await db.query(
      "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) values($1,$2,'Sneaker','40 Black',10,10)",
      [order, products[0].id],
    );
    await db.query(
      "insert into public.delivery_handoffs(order_id,branch_id,status,original_resolution,reason,created_by,created_at) values($1,$2,'accepted','Resolved','Backup',$3,date_trunc('month',now())-interval '1 month')",
      [order, b, users.hq],
    );
    const declined = randomUUID();
    await db.query(
      "insert into public.delivery_handoffs(id,order_id,branch_id,status,original_resolution,reason,created_by,created_at) values($1,$2,$3,'declined','Resolved','Shortage',$4,date_trunc('month',now())-interval '2 months')",
      [declined, order, other, users.hq],
    );
    await db.query(
      "insert into supplylink_private.backup_declines(handoff_id,cause) values($1,'stock_shortage')",
      [declined],
    );
  }
  const snapshot: PlanningSnapshot = await rpc("snapshot", {
    branchId: b,
    month,
  });
  const row = snapshot.current.find((r) => r.productId === products[0].id)!;
  expect(row.completeMonths).toBe(3);
  expect(row.backupOrders).toBe(5);
  expect(row.backupUnits).toBe(50);
  expect(row.baseline).toBeNull(); // Backup refill lead-time evidence is still missing.
  const otherSnapshot: PlanningSnapshot = await rpc("snapshot", {
    branchId: other,
    month,
  });
  expect(
    otherSnapshot.current.find((r) => r.productId === products[0].id)!
      .backupUnits,
  ).toBe(0);
});
