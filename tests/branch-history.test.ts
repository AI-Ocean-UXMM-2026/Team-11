import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { BranchHistory } from "../src/lib/branch-history";
const db = new PGlite();
const a = randomUUID(),
  b = randomUUID();
const users = {
  hq: randomUUID(),
  branch: randomUUID(),
  sme: randomUUID(),
  driver: randomUUID(),
  pending: randomUUID(),
  suspended: randomUUID(),
};
async function history(
  user: keyof typeof users,
  branch = a,
  page = 1,
  size = 25,
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[user],
    ]);
    await tx.exec("set local role authenticated");
    return (
      await tx.query<{ result: BranchHistory }>(
        "select public.branch_transfer_history($1,$2,$3) result",
        [branch, page, size],
      )
    ).rows[0].result;
  });
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Branch A','Yangon'),($2,'Branch B','Yangon')",
    [a, b],
  );
  for (const [role, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,branch_id,must_change_password,status) values($1,$2,$2,$3,$4,$5,$6)",
      [
        id,
        `history.${role}`,
        ["pending", "suspended"].includes(role) ? "hq" : role,
        role === "branch" ? a : null,
        role === "pending",
        role === "suspended" ? "suspended" : "active",
      ],
    );
  }
  const product = (
    await db.query<{ id: string }>("select id from public.products limit 1")
  ).rows[0].id;
  await db.query(
    `insert into public.stock_transfers(reference,destination_branch_id,product_id,quantity,reason,created_by,status,created_at)
 select 'BRANCH-HISTORY-'||n,case when n<=31 then $1::uuid else $2::uuid end,$3,2,'Test history',$4,case when n<=2 then 'reserved' else 'received' end,'2026-10-21T08:00:00Z' from generate_series(1,36) n`,
    [a, b, product, users.hq],
  );
  await db.query(
    "insert into public.stock_transfers(reference,source_branch_id,product_id,quantity,reason,created_by,status) values('BRANCH-RETURN',$1,$2,3,'Return test',$3,'shipping')",
    [a, product, users.hq],
  );
});
afterAll(() => db.close());
it("counts and paginates all selected-branch refills and returns without other branches", async () => {
  const first = await history("hq"),
    second = await history("hq", a, 2);
  expect(first.pagination).toEqual({ page: 1, pageSize: 25, total: 32 });
  expect(second.rows).toHaveLength(7);
  expect(first.pending).toBe(3);
  expect(
    first.rows
      .concat(second.rows)
      .every((t) => t.sourceBranchId === a || t.destinationBranchId === a),
  ).toBe(true);
  expect(new Set(first.rows.concat(second.rows).map((t) => t.id)).size).toBe(
    32,
  );
  expect((await history("hq", b)).pagination.total).toBe(5);
});
it("handles empty, closed and invalid branch histories and clamps the last page", async () => {
  expect((await history("hq", a, 999)).pagination.page).toBe(2);
  const empty = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address,active) values($1,'Closed empty','Yangon',false)",
    [empty],
  );
  expect((await history("hq", empty)).rows).toEqual([]);
  await expect(history("hq", randomUUID())).rejects.toThrow(/Branch not found/);
  for (const [page, size] of [
    [0, 25],
    [1, 1000],
  ])
    await expect(history("hq", a, page, size)).rejects.toThrow(
      /Invalid history page/,
    );
});
it("rejects non-HQ, suspended, first-login and anonymous direct RPC calls", async () => {
  for (const user of [
    "branch",
    "sme",
    "driver",
    "pending",
    "suspended",
  ] as const)
    await expect(history(user)).rejects.toThrow();
  await expect(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select public.branch_transfer_history($1)", [a]);
    }),
  ).rejects.toThrow(/permission denied/);
});
