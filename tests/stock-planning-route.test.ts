import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
  explain: vi.fn(),
}));
vi.mock("../src/lib/workflow/server", () => ({
  workflowActor: mocks.actor,
  WorkflowError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/lib/workflow/stock-planning", () => ({
  planningRpc: mocks.rpc,
  explainStockPlan: mocks.explain,
  explanationConfiguration: () => ({ configured: false, model: "test:free" }),
}));
import { GET, POST } from "../src/app/api/stock-planning/route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue({ id, role: "hq" });
  mocks.rpc.mockReset().mockResolvedValue({ id });
  mocks.explain.mockReset();
});
const post = (payload: object, origin = "https://supply.test") =>
  POST(
    new Request("https://supply.test/api/stock-planning", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
it("serves overview/details and validates manual settings and dispatch confirmation before RPC", async () => {
  expect(
    (
      await GET(
        new Request("https://supply.test/api/stock-planning?view=overview"),
      )
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith(expect.anything(), "overview", {});
  expect(
    (
      await GET(
        new Request(
          `https://supply.test/api/stock-planning?view=detail&branchId=${id}&productId=${id}`,
        ),
      )
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith(expect.anything(), "detail", {
    branchId: id,
    productId: id,
  });
  mocks.rpc.mockClear();
  const values = {
    action: "settings",
    key: id,
    branchId: id,
    productId: id,
    target: 60,
    threshold: 61,
    unit: "pairs",
    reason: "Initial manual reserve",
  };
  expect((await post(values)).status).toBe(400);
  expect(
    (
      await post({
        action: "dispatch_refill",
        key: id,
        branchId: id,
        productId: id,
        transferId: id,
        confirmed: false,
        reason: "Not dispatched yet",
      })
    ).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await post({ ...values, threshold: 20 })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    expect.anything(),
    "settings",
    expect.objectContaining({ target: 60, threshold: 20, source: "manual" }),
    id,
  );
});
it("checks origin, body limits, input shapes and HQ access before mutations", async () => {
  expect(
    (
      await post(
        { action: "approve", planId: id, key: id, reason: "Reviewed" },
        "https://other.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await post({ action: "generate", branchId: id, month: "2026-13-01" }))
      .status,
  ).toBe(400);
  expect((await post({ text: "x".repeat(24000) })).status).toBe(413);
  mocks.actor.mockResolvedValue({ id, role: "sme" });
  expect(
    (await post({ action: "approve", planId: id, key: id, reason: "Reviewed" }))
      .status,
  ).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns private uncached snapshots and requires a completed authenticated identity", async () => {
  const result = await GET(
    new Request(
      `https://supply.test/api/stock-planning?branchId=${id}&month=2026-11-01`,
    ),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  mocks.actor.mockRejectedValue(new Error("Sign in again"));
  expect(
    (
      await GET(
        new Request(
          `https://supply.test/api/stock-planning?branchId=${id}&month=2026-11-01`,
        ),
      )
    ).status,
  ).not.toBe(200);
});
