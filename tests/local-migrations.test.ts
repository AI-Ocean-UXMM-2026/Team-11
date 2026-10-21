import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { localRequest, supabaseStubs } from "../src/lib/workflow/local";

const runtime = globalThis as typeof globalThis & {
  workflowDb?: Promise<PGlite>;
  workflowQueue?: Promise<unknown>;
};
let db: PGlite;
afterEach(async () => {
  delete runtime.workflowDb;
  delete runtime.workflowQueue;
  if (db) await db.close();
});

it("upgrades a database retained through hot reload before handling branch pin requests", async () => {
  db = new PGlite();
  await db.exec(supabaseStubs);
  await db.exec(
    "create table public.workflow_migrations(name text primary key)",
  );
  const pending = "20261021092923_branch_location_pins.sql";
  for (const name of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql") && name < pending)
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.query("insert into public.workflow_migrations values($1)", [name]);
  }
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  runtime.workflowDb = Promise.resolve(db);
  const request = () =>
    localRequest(
      "demo-hq",
      async (tx) =>
        (
          await tx.query(
            "select latitude,longitude from public.branches limit 1",
          )
        ).rows[0],
    );
  expect(await request()).toEqual({ latitude: null, longitude: null });
  expect(await request()).toEqual({ latitude: null, longitude: null });
  expect(
    (
      await db.query("select * from public.workflow_migrations where name=$1", [
        pending,
      ])
    ).rows,
  ).toHaveLength(1);
}, 30000);
