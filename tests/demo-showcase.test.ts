import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { localRequest } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";

const runtime = globalThis as typeof globalThis & {
  workflowDb?: Promise<PGlite>;
  workflowQueue?: Promise<unknown>;
  workflowShowcaseEligible?: boolean;
};
let folder: string;
afterEach(async () => {
  if (runtime.workflowDb) await (await runtime.workflowDb).close();
  delete runtime.workflowDb;
  delete runtime.workflowQueue;
  delete runtime.workflowShowcaseEligible;
  vi.unstubAllEnvs();
  if (folder?.startsWith(path.join(os.tmpdir(), "supplylink-showcase-test-")))
    await rm(folder, { recursive: true, force: true });
});
it("seeds a fresh local demo with actionable holds, stock and private proofs exactly once", async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "supplylink-showcase-test-"));
  vi.stubEnv("SUPPLYLINK_DEMO_DATA_DIR", folder);
  const snapshot = () =>
    localRequest(
      "demo-hq",
      async (tx) =>
        (
          await tx.query<{ data: WorkspaceData }>(
            "select public.workflow_snapshot('{}'::jsonb) data",
          )
        ).rows[0].data,
    );
  const first = await snapshot();
  expect(first.summary?.orders).toBe(10);
  expect(first.summary?.held).toBe(2);
  expect(first.summary?.awaiting).toBe(2);
  expect(first.products).toHaveLength(6);
  expect(first.accounts.find((a) => a.username === "aungthu")?.branchName).toBe(
    "Hlaing branch",
  );
  expect(first.products.every((p) => p.stock > 100)).toBe(true);
  expect(first.retailSales).toHaveLength(3);
  expect(first.salesEvents).toHaveLength(5);
  expect(first.transfers?.map((t) => t.status).sort()).toEqual([
    "received",
    "reserved",
    "shipping",
  ]);
  expect(
    (await readFile(path.join(folder, "samples", "demo-receipt.png")))
      .subarray(1, 4)
      .toString(),
  ).toBe("PNG");
  const second = await snapshot();
  expect(second.orders.map((o) => o.id)).toEqual(first.orders.map((o) => o.id));
  expect(second.salesEvents).toHaveLength(5);
}, 30000);
