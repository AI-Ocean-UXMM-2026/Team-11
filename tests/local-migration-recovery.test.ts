import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ empty: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      state.empty &&
      String(args[0]).endsWith("20261022064710_branch_refill_requests.sql")
        ? Promise.resolve("-- Migration is still being written.\n")
        : actual.readFile(...args),
  };
});
import { localRequest, supabaseStubs } from "../src/lib/workflow/local";
const pending = "20261022064710_branch_refill_requests.sql";
const runtime = globalThis as typeof globalThis & {
  workflowDb?: Promise<PGlite>;
  workflowQueue?: Promise<unknown>;
  workflowShowcaseEligible?: boolean;
};
let db: PGlite;
beforeEach(async () => {
  state.empty = false;
  // Database construction is fixture setup, not part of the recovery operation.
  // Keep the assertions under the normal timeout as the migration chain grows.
  await existingDatabase();
});
afterEach(async () => {
  delete runtime.workflowDb;
  delete runtime.workflowQueue;
  delete runtime.workflowShowcaseEligible;
  state.empty = false;
  if (db) await db.close();
});
async function existingDatabase() {
  db = new PGlite();
  await db.exec(supabaseStubs);
  await db.exec(
    "create table public.workflow_migrations(name text primary key)",
  );
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n < pending)
    .sort()) {
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
    await db.query("insert into public.workflow_migrations values($1)", [name]);
  }
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.exec(
    "create table public.repair_sentinel(note text); insert into public.repair_sentinel values('Retain existing data');",
  );
  runtime.workflowDb = Promise.resolve(db);
}
const request = () =>
  localRequest(
    "demo-hq",
    async (tx) =>
      (
        await tx.query<{ table_name: string }>(
          "select to_regclass('supplylink_private.branch_refill_requests')::text table_name",
        )
      ).rows[0].table_name,
  );
it("repairs an empty migration recorded as complete and preserves existing database rows", async () => {
  await db.query("insert into public.workflow_migrations values($1)", [
    pending,
  ]);
  expect(await request()).toBe("supplylink_private.branch_refill_requests");
  expect((await db.query("select * from public.repair_sentinel")).rows).toEqual(
    [{ note: "Retain existing data" }],
  );
  expect(
    (
      await db.query("select * from public.workflow_migrations where name=$1", [
        pending,
      ])
    ).rows,
  ).toHaveLength(1);
  expect(await request()).toBe("supplylink_private.branch_refill_requests");
});
it("refuses empty/comment-only migration files and retries after their SQL is saved", async () => {
  state.empty = true;
  await expect(request()).rejects.toThrow(/has no SQL yet/);
  expect(
    (
      await db.query("select * from public.workflow_migrations where name=$1", [
        pending,
      ])
    ).rows,
  ).toHaveLength(0);
  state.empty = false;
  expect(await request()).toBe("supplylink_private.branch_refill_requests");
});
it("stops on a partially present schema instead of blindly replaying destructive renames", async () => {
  await db.exec(
    "create table supplylink_private.branch_refill_requests(id uuid)",
  );
  await db.query("insert into public.workflow_migrations values($1)", [
    pending,
  ]);
  await expect(request()).rejects.toThrow(/incomplete schema/);
  expect(
    (await db.query("select * from public.repair_sentinel")).rows,
  ).toHaveLength(1);
});
it("clears a rejected initialization promise so later sign-ins can recover", async () => {
  const failure = Promise.reject(new Error("Startup failed"));
  void failure.catch(() => {});
  runtime.workflowDb = failure;
  await expect(request()).rejects.toThrow("Startup failed");
  expect(runtime.workflowDb).toBeUndefined();
  runtime.workflowDb = Promise.resolve(db);
  expect(await request()).toBe("supplylink_private.branch_refill_requests");
});
