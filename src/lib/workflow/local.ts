import { PGlite, type Transaction } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { demoDirectory } from "../auth/demo-directory";
import { seedDemoShowcase } from "./demo-showcase";

export function localIdentity(id: string) {
  if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  const hex = createHash("sha256").update(id).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const localRoot = () =>
  process.env.SUPPLYLINK_DEMO_DATA_DIR ?? path.join(process.cwd(), ".data");
export const supabaseStubs = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, encrypted_password text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth,storage to authenticated,anon,service_role;
  grant execute on function auth.uid() to authenticated,anon,service_role;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant select on storage.objects to authenticated;
`;
const runtime = globalThis as typeof globalThis & {
  workflowDb?: Promise<PGlite>;
  workflowQueue?: Promise<unknown>;
  workflowShowcaseEligible?: boolean;
};
const migrated = new WeakSet<PGlite>();
// The database survives Next.js hot reload; the migration list may be newer.
// localRequest serializes this check with operational transactions.
async function applyMigrations(db: PGlite) {
  if (migrated.has(db)) return;
  for (const name of [
    "202610200001_baseline.sql",
    "202610200002_stt_catalog.sql",
    "202610210003_order_workflow.sql",
    "202610210004_order_history.sql",
    "20261021045326_branch_operations.sql",
    "20261021060000_workspace_pagination.sql",
    "20261021060001_branch_sales_totals.sql",
    "20261021083626_account_locations_order_ids.sql",
    "20261021092923_branch_location_pins.sql",
    "20261021104603_driver_pickup_tracking.sql",
    "20261021140016_branch_transfer_history.sql",
  ]) {
    const done = await db.query(
      "select 1 from public.workflow_migrations where name=$1",
      [name],
    );
    if (!done.rows.length) {
      await db.exec(
        await readFile(
          path.join(process.cwd(), "supabase/migrations", name),
          "utf8",
        ),
      );
      await db.query("insert into public.workflow_migrations values($1)", [
        name,
      ]);
    }
  }
  migrated.add(db);
}
async function initialize() {
  await mkdir(localRoot(), { recursive: true });
  const db = new PGlite(path.join(localRoot(), "workflow"));
  await db.waitReady;
  const { rows } = await db.query<{ present: string | null }>(
    "select to_regclass('public.workflow_migrations')::text as present",
  );
  if (!rows[0].present) {
    runtime.workflowShowcaseEligible = true;
    await db.exec(supabaseStubs);
    await db.exec(
      "create table public.workflow_migrations(name text primary key)",
    );
  }
  await applyMigrations(db);
  const seeded = await db.query("select 1 from public.branches limit 1");
  if (!seeded.rows.length) {
    await db.exec(
      await readFile(path.join(process.cwd(), "supabase/seed.sql"), "utf8"),
    );
    await db.exec(
      "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) select b.id,p.id,24,4 from public.branches b cross join public.products p where p.brand='STT' on conflict do nothing",
    );
    await db.exec(
      "update public.workflow_settings set shipping_fee=5000,payment_instructions='Demo only — use a sample proof image. Do not send real money. HQ checks the simulated receiving account before approval.'",
    );
  }
  return db;
}
export async function localRequest<T>(
  actorId: string,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const previous = runtime.workflowQueue ?? Promise.resolve();
  const request = previous
    .catch(() => {})
    .then(async () => {
      const db = await (runtime.workflowDb ??= initialize());
      await applyMigrations(db);
      const result = await db.transaction(async (tx) => {
        const branch = await tx.query<{ id: string }>(
          "select id from public.branches where name='Hlaing branch' limit 1",
        );
        const users = demoDirectory().workflowUsers();
        await tx.query(
          "update public.profiles set status='suspended' where not(id=any($1::uuid[]))",
          [users.map((u) => localIdentity(u.id))],
        );
        for (const user of users) {
          const id = localIdentity(user.id);
          const existing = await tx.query<{
            status: string;
            branch_id: string | null;
          }>("select status,branch_id from public.profiles where id=$1", [id]);
          const affiliation =
            existing.rows[0]?.branch_id ??
            user.branchId ??
            (user.role === "branch" ? branch.rows[0].id : null);
          const open = affiliation
            ? await tx.query(
                "select 1 from public.branches where id=$1 and active",
                [affiliation],
              )
            : null;
          const status =
            user.status !== "Active" ||
            existing.rows[0]?.status === "suspended" ||
            (open && !open.rows.length)
              ? "suspended"
              : "active";
          await tx.query(
            "insert into auth.users(id) values($1) on conflict do nothing",
            [id],
          );
          await tx.query(
            `insert into public.profiles(id,username,name,role,status,must_change_password,phone,address,branch_id,latitude,longitude)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do update set status=case when excluded.status='suspended' then excluded.status else public.profiles.status end,must_change_password=excluded.must_change_password`,
            [
              id,
              user.username,
              user.name,
              user.role,
              status,
              user.mustChangePassword,
              user.phone,
              user.affiliation,
              affiliation,
              user.pin?.latitude ?? null,
              user.pin?.longitude ?? null,
            ],
          );
        }
        if (runtime.workflowShowcaseEligible)
          await seedDemoShowcase(tx, localRoot());
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          localIdentity(actorId),
        ]);
        await tx.exec("set local role authenticated");
        return action(tx);
      });
      runtime.workflowShowcaseEligible = false;
      return result;
    });
  runtime.workflowQueue = request;
  return request;
}
export async function localObject(actorId: string, name: string) {
  return localRequest(actorId, async (tx) => {
    await tx.exec("reset role");
    await tx.query(
      "insert into storage.objects(bucket_id,name) values('payment-evidence',$1) on conflict do nothing",
      [name],
    );
  });
}
