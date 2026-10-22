import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";
import type { BranchHistory } from "../src/lib/branch-history";

const db = new PGlite();
const migration = "20261022064710_branch_refill_requests.sql";
const a = randomUUID(),
  b = randomUUID(),
  closed = randomUUID();
const users = {
  hq: randomUUID(),
  branch: randomUUID(),
  sme: randomUUID(),
  driver: randomUUID(),
  suspended: randomUUID(),
  pending: randomUUID(),
};
let product: string, second: string;
async function asUser<T>(
  user: keyof typeof users,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[user],
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<{ result: T }>(sql, params)).rows[0]?.result;
  });
}
const snapshot = (user: keyof typeof users) =>
  asUser<WorkspaceData>(
    user,
    "select public.workflow_snapshot('{}'::jsonb) result",
  );
async function request(branch = a, sku = product) {
  return (
    await db.query<{ id: string; on_hand: number; resolved_at: string | null }>(
      "select id,on_hand,resolved_at from supplylink_private.branch_refill_requests where branch_id=$1 and product_id=$2 and resolved_at is null",
      [branch, sku],
    )
  ).rows;
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const file of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n < migration)
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  [product, second] = (
    await db.query<{ id: string }>(
      "select id from public.products where active and brand='STT' order by id limit 2",
    )
  ).rows.map((p) => p.id);
  await db.query(
    "insert into public.branches(id,name,address,active) values($1,'Refill A','Yangon',true),($2,'Refill B','Yangon',true),($3,'Closed branch','Yangon',false)",
    [a, b, closed],
  );
  for (const [role, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,branch_id,status,must_change_password) values($1,$2,$2,$3,$4,$5,$6)",
      [
        id,
        `refill.${role}`,
        ["pending", "suspended"].includes(role) ? "hq" : role,
        role === "branch" ? a : null,
        role === "suspended" ? "suspended" : "active",
        role === "pending",
      ],
    );
  }
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,allocated,protected_reserve) values($1,$4,9,0,0),($1,$5,10,6,4),($2,$4,9,0,0),($3,$4,2,0,0),(null,$4,100,0,0) on conflict(branch_id,product_id) do update set on_hand=excluded.on_hand,allocated=excluded.allocated,protected_reserve=excluded.protected_reserve",
    [a, b, closed, product, second],
  );
  await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
});
afterAll(() => db.close());

it("backfills low branch stock, ignores HQ/closed branches and uses on-hand rather than retail availability", async () => {
  expect(await request()).toHaveLength(1);
  expect(await request(a, second)).toHaveLength(0); // 10 on hand, zero retail-available.
  expect(await request(closed)).toHaveLength(0);
  const hq = await snapshot("hq");
  expect(
    hq.refillRequests!.some(
      (r) => r.branchId === a && r.productId === product && r.onHand === 9,
    ),
  ).toBe(true);
  expect(hq.refillRequests!.every((r) => r.branchId !== closed)).toBe(true);
  const count = await db.query<{ n: number }>(
    "select count(*)::integer n from supplylink_private.branch_refill_requests where branch_id is null",
  );
  expect(count.rows[0].n).toBe(0);
});
it("updates one open request while low, resolves at exactly 10 and creates a fresh request on the next low-stock episode", async () => {
  const first = (await request())[0];
  await db.query(
    "update public.inventory set on_hand=8 where branch_id=$1 and product_id=$2",
    [a, product],
  );
  await db.query(
    "update public.inventory set on_hand=8 where branch_id=$1 and product_id=$2",
    [a, product],
  );
  expect(await request()).toEqual([
    { id: first.id, on_hand: 8, resolved_at: null },
  ]);
  await db.query(
    "update public.inventory set on_hand=10 where branch_id=$1 and product_id=$2",
    [a, product],
  );
  expect(await request()).toHaveLength(0);
  expect(
    (
      await db.query<{ resolved_at: string | null }>(
        "select resolved_at from supplylink_private.branch_refill_requests where id=$1",
        [first.id],
      )
    ).rows[0].resolved_at,
  ).not.toBeNull();
  await db.query(
    "update public.inventory set on_hand=9 where branch_id=$1 and product_id=$2",
    [a, product],
  );
  expect((await request())[0].id).not.toBe(first.id);
});
it("keeps the request until physical receipt and shows already-reserved incoming pairs to HQ", async () => {
  await db.query(
    "update public.inventory set on_hand=3 where branch_id=$1 and product_id=$2",
    [a, product],
  );
  const originalId = (await request())[0].id;
  const execute = (user: keyof typeof users, action: string, payload: object) =>
    asUser<{ transferId?: string }>(
      user,
      "select public.workflow_execute($1,$2::jsonb,$3::uuid) result",
      [action, JSON.stringify(payload), randomUUID()],
    );
  for (const quantity of [4, 3]) {
    const transfer = await execute("hq", "transfer_create", {
      destinationBranchId: a,
      productId: product,
      quantity,
      reason: "Retail refill test",
    });
    const row = (await snapshot("hq")).refillRequests!.find(
      (r) => r.branchId === a && r.productId === product,
    )!;
    expect(row.incoming).toBe(quantity);
    expect(row.id).toBe(originalId);
    await execute("hq", "transfer_dispatch", {
      transferId: transfer.transferId,
      confirmed: true,
    });
    expect(await request()).toHaveLength(1);
    await execute("branch", "transfer_receive", {
      transferId: transfer.transferId,
      confirmed: true,
    });
    expect(await request()).toHaveLength(quantity === 4 ? 1 : 0);
  }
});
it("scopes notifications to HQ and the owning branch, and denies direct table/privileged helper access", async () => {
  const own = await snapshot("branch");
  expect(own.refillRequests!.length).toBeGreaterThan(0);
  expect(own.refillRequests!.every((r) => r.branchId === a)).toBe(true);
  for (const role of ["sme", "driver"] as const)
    expect((await snapshot(role)).refillRequests).toEqual([]);
  for (const role of ["suspended", "pending"] as const)
    await expect(snapshot(role)).rejects.toThrow();
  await expect(
    asUser("hq", "select * from supplylink_private.branch_refill_requests"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    asUser(
      "branch",
      "select supplylink_private.refill_notifications($1) result",
      [b],
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select public.workflow_snapshot('{}'::jsonb)");
    }),
  ).rejects.toThrow(/permission denied/);
});
it("includes branch requests in branch history and the legacy no-argument snapshot", async () => {
  const history = await asUser<BranchHistory>(
    "hq",
    "select public.branch_transfer_history($1) result",
    [b],
  );
  expect(history.refillRequests!.length).toBeGreaterThan(0);
  expect(history.refillRequests!.every((r) => r.branchId === b)).toBe(true);
  const legacy = await asUser<WorkspaceData>(
    "hq",
    "select public.workflow_snapshot() result",
  );
  expect(legacy.refillRequestCount).toBe(
    (await snapshot("hq")).refillRequestCount,
  );
  await expect(
    asUser("branch", "select public.branch_transfer_history($1) result", [b]),
  ).rejects.toThrow();
});
it("raises requests automatically for every zero-stock SKU in a newly created branch", async () => {
  const created = await asUser<{ branchId: string }>(
    "hq",
    "select public.workflow_execute('branch_create',$1::jsonb,$2::uuid) result",
    [
      JSON.stringify({
        name: "New refill branch",
        pin: { latitude: 16.8, longitude: 96.1 },
      }),
      randomUUID(),
    ],
  );
  const count = (
    await db.query<{ n: number }>(
      "select count(*)::integer n from public.products where active and brand='STT'",
    )
  ).rows[0].n;
  expect(
    (await snapshot("hq")).refillRequests!.filter(
      (r) => r.branchId === created.branchId,
    ),
  ).toHaveLength(count);
});
