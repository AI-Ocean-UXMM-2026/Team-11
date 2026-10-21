import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";
import { workspaceQuerySchema } from "../src/lib/workflow/query";
import { exportCsv, type ExportPage } from "../src/lib/workflow/exports";

const db = new PGlite();
const ids = {
  hq: randomUUID(),
  sme: randomUUID(),
  other: randomUUID(),
  branch: randomUUID(),
  otherBranch: randomUUID(),
  driver: randomUUID(),
  pending: randomUUID(),
};
const branchId = randomUUID(),
  otherBranchId = randomUUID();
let productId: string;
async function asUser<T>(
  user: keyof typeof ids,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      ids[user],
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<{ result: T }>(sql, values)).rows[0].result;
  });
}
const list = (user: keyof typeof ids, kind: string, query = {}) =>
  asUser<ExportPage>(user, "select public.workflow_list($1,$2::jsonb) result", [
    kind,
    JSON.stringify(query),
  ]);
const snapshot = (user: keyof typeof ids, query = {}) =>
  asUser<WorkspaceData>(
    user,
    "select public.workflow_snapshot($1::jsonb) result",
    [JSON.stringify(query)],
  );
const selection = { reportFrom: "2026-10-01", reportTo: "2026-10-31" };
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Branch A','Yangon'),($2,'Branch B','Yangon')",
    [branchId, otherBranchId],
  );
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    const role =
      name === "hq"
        ? "hq"
        : name === "driver"
          ? "driver"
          : name.toLowerCase().includes("branch")
            ? "branch"
            : "sme";
    await db.query(
      "insert into public.profiles(id,username,name,role,branch_id,must_change_password) values($1,$2,$2,$3,$4,$5)",
      [
        id,
        `${name.toLowerCase()}.page`,
        role,
        role === "branch" || role === "driver"
          ? name === "otherBranch"
            ? otherBranchId
            : branchId
          : null,
        name === "pending",
      ],
    );
  }
  productId = (
    await db.query<{ id: string }>(
      "select id from public.products where brand='STT' limit 1",
    )
  ).rows[0].id;
  // All timestamps tie deliberately: the UUID tiebreaker must prevent overlap.
  await db.query(
    `insert into public.orders(reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,source_branch_id,created_at)
    select 'PAGE-'||lpad(n::text,5,'0'),$1,'Shop '||n,'Yangon','Receiver','091234567',1,1000,500,'Draft',case when n<=35 then $2::uuid else null end,'2026-10-01T00:00:00Z' from generate_series(1,10025) n`,
    [ids.sme, branchId],
  );
  await db.query(
    "insert into public.orders(reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,source_branch_id) values('PRIVATE-OTHER',$1,'Other shop','Yangon','Other','099999999',1,7000,0,'Draft',$2)",
    [ids.other, otherBranchId],
  );
  await db.query(
    "insert into public.delivery_attempts(order_id,driver_id,source_branch_id) select id,$1,$2 from public.orders where source_branch_id=$2",
    [ids.driver, branchId],
  );
  await db.query(
    `insert into public.retail_sales(reference,branch_id,actor_id,operation_key,merchandise_total,confirmed_at)
    select 'RETAIL-'||n,case when n<=65 then $1::uuid else $2::uuid end,case when n<=65 then $3::uuid else $4::uuid end,gen_random_uuid(),1000,'2026-10-10T00:00:00Z' from generate_series(1,66) n`,
    [branchId, otherBranchId, ids.branch, ids.otherBranch],
  );
  await db.query(
    "insert into public.sales_events(reference,channel,sale_id,branch_id,merchandise,units,occurred_at) select reference,'Retail',id,branch_id,merchandise_total,1,confirmed_at from public.retail_sales",
  );
  // Wholesale uses an independent event so channel totals must reconcile too.
  await db.query(
    "insert into public.sales_events(reference,channel,order_id,merchandise,units,occurred_at) select reference,'Wholesale',id,2000,1,'2026-10-10T00:00:00Z' from public.orders where reference='PAGE-00001'",
  );
  await db.query(
    `insert into public.stock_transfers(reference,destination_branch_id,product_id,quantity,reason,created_by,created_at)
    select 'TRANSFER-'||n,case when n<=35 then $1::uuid else $2::uuid end,$3,1,'Pagination fixture',$4,'2026-10-10T00:00:00Z' from generate_series(1,36) n`,
    [branchId, otherBranchId, productId, ids.hq],
  );
}, 30000);
afterAll(() => db.close());

it("loads a bounded workspace beyond 10,000 orders with full dashboard totals", async () => {
  const data = await snapshot("hq", selection);
  expect(data.orders).toHaveLength(25);
  expect(data.pagination!.orders).toEqual({
    page: 1,
    pageSize: 25,
    total: 10026,
  });
  expect(data.summary).toMatchObject({
    orders: 10026,
    retail: 66000,
    retailCount: 66,
    pendingTransfers: 36,
  });
  expect(data.branches.find((b) => b.id === branchId)?.sales).toBe(65000);
  expect(
    (await snapshot("sme", selection)).branches.every((b) => b.sales === 0),
  ).toBe(true);
  expect(data.retailSales).toHaveLength(25);
  expect(data.transfers).toHaveLength(25);
  expect(data.salesEvents).toHaveLength(25);
  expect(data.report).toMatchObject({ retail: 66000, wholesale: 2000 });
});
it("orders tied on creation time traverse deterministically without duplicates", async () => {
  const first = await list("sme", "orders");
  const second = await list("sme", "orders", { page: 2 });
  expect(first.total).toBe(10025);
  expect(second.rows).toHaveLength(25);
  expect(
    new Set([...first.rows, ...second.rows].map((o: any) => o.id)).size,
  ).toBe(50);
  expect((await list("sme", "orders")).rows).toEqual(first.rows);
});
it("filters in the database, clamps deleted or out-of-range pages and handles empty results", async () => {
  const found = await list("sme", "orders", { search: "PAGE-10025", page: 99 });
  expect(found).toMatchObject({ page: 1, total: 1 });
  expect((found.rows[0] as any).reference).toBe("PAGE-10025");
  expect(await list("sme", "orders", { search: "%_", page: 4 })).toMatchObject({
    rows: [],
    page: 1,
    total: 0,
  });
  expect(await list("sme", "orders", { status: "Shipping" })).toMatchObject({
    rows: [],
    total: 0,
  });
  const last = await list("sme", "orders", { page: 1000000, pageSize: 100 });
  expect(last).toMatchObject({ page: 101, total: 10025 });
  expect(last.rows).toHaveLength(25);
});
it("preserves SME, branch and driver ownership on later pages and direct details", async () => {
  const otherOrder = (await list("other", "orders")).rows[0] as any;
  expect(
    (await snapshot("sme", { orderId: otherOrder.id })).selectedOrder,
  ).toBeNull();
  const ownOrder = (await list("sme", "orders")).rows[0] as { id: string };
  const detail = await snapshot("sme", { ordersPage: 2, orderId: ownOrder.id });
  expect(detail.selectedOrder?.id).toBe(ownOrder.id);
  expect(detail.orders.some((o) => o.id === ownOrder.id)).toBe(false);
  const branchPage = await list("branch", "orders", { page: 2 });
  expect(branchPage).toMatchObject({ page: 2, total: 35 });
  expect(branchPage.rows).toHaveLength(10);
  const driverPage = await list("driver", "orders", { page: 2 });
  expect(driverPage.total).toBe(35);
  for (const o of [...branchPage.rows, ...driverPage.rows] as any[]) {
    expect(o.merchandise).toBe(0);
    expect(o.workflow.evidence).toEqual([]);
    expect(o.workflow.instructions).toBe("");
  }
  expect(
    await list("driver", "orders", { orderId: otherOrder.id }),
  ).toMatchObject({ rows: [], total: 0 });
});
it("paginates branch retail and transfers without including another branch", async () => {
  const retail = await list("branch", "retail", { page: 3 });
  expect(retail).toMatchObject({ page: 3, total: 65 });
  expect(retail.rows).toHaveLength(15);
  expect(retail.rows.every((s: any) => s.branchId === branchId)).toBe(true);
  const transfers = await list("branch", "transfers", { page: 2 });
  expect(transfers.total).toBe(35);
  expect(
    transfers.rows.every((t: any) => t.destinationBranchId === branchId),
  ).toBe(true);
});
it("keeps full-period report totals, branch scope and a fixed export cutoff across pages", async () => {
  const first = await list("branch", "report", selection);
  const second = await list("branch", "report", {
    ...selection,
    reportCutoff: first.cutoff,
    page: 2,
  });
  expect(first).toMatchObject({
    total: 65,
    summary: { retail: 65000, wholesale: 0 },
  });
  expect(second.summary).toEqual(first.summary);
  expect(second.cutoff).toBe(first.cutoff);
  const wholesale = await list("hq", "report", {
    ...selection,
    reportChannel: "Wholesale",
  });
  expect(wholesale).toMatchObject({
    total: 1,
    summary: { wholesale: 2000, retail: 0 },
  });
  const empty = await list("hq", "report", {
    reportFrom: "2020-01-01",
    reportTo: "2020-01-31",
  });
  expect(empty).toMatchObject({
    total: 0,
    rows: [],
    summary: { wholesale: 0, retail: 0 },
  });
  // An event posted after the selected cutoff cannot change that selection.
  expect(
    await list("hq", "report", {
      ...selection,
      reportCutoff: "2026-10-09T23:59:59Z",
    }),
  ).toMatchObject({ rows: [], total: 0 });
});
it("exports every report page and reconciles the CSV total", async () => {
  const first = await list("hq", "report", selection);
  let csv = "";
  for await (const chunk of exportCsv(
    "report",
    first,
    (page) =>
      list("hq", "report", { ...selection, reportCutoff: first.cutoff, page }),
    selection,
  ))
    csv += chunk;
  expect(csv.match(/"RETAIL-\d+"/g)).toHaveLength(66);
  expect(csv).toContain('"PAGE-00001","Wholesale"');
  expect(csv).toContain('"Total","","","68000"');
});
it("exports matching orders across pages rather than only the visible page", async () => {
  const query = { search: "PAGE-100", pageSize: 25 };
  const first = await list("sme", "orders", query);
  let csv = "";
  for await (const chunk of exportCsv(
    "orders",
    first,
    (page) => list("sme", "orders", { ...query, page }),
    {},
  ))
    csv += chunk;
  expect(first.total).toBe(26);
  expect(csv.match(/"PAGE-100\d\d"/g)).toHaveLength(26);
});
it("rejects unauthorized report access, invalid queries and internal helper calls", async () => {
  await expect(list("sme", "report", selection)).rejects.toThrow("restricted");
  await expect(list("driver", "retail")).rejects.toThrow("restricted");
  await expect(list("pending", "orders")).rejects.toThrow("active");
  await expect(list("hq", "orders", { page: 0 })).rejects.toThrow("pagination");
  await expect(list("hq", "orders", { pageSize: 10000 })).rejects.toThrow(
    "pagination",
  );
  await expect(
    list("hq", "report", { reportFrom: "2026-11-01", reportTo: "2026-10-01" }),
  ).rejects.toThrow("selection");
  await expect(
    asUser("hq", "select supplylink_private.workspace_actor() result"),
  ).rejects.toThrow();
  await db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    await expect(
      tx.query("select public.workflow_list('orders','{}')"),
    ).rejects.toThrow("permission denied");
  });
  expect(workspaceQuerySchema.safeParse({ ordersPage: -1 }).success).toBe(
    false,
  );
  expect(workspaceQuerySchema.safeParse({ pageSize: 10000 }).success).toBe(
    false,
  );
});
