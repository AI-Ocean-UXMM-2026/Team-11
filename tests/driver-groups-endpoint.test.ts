import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  list: vi.fn(),
  action: vi.fn(),
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
vi.mock("../src/lib/workflow/delivery-groups", () => ({
  driverDeliveryGroups: mocks.list,
  driverGroupAction: mocks.action,
}));
import { GET, POST } from "../src/app/api/driver/delivery-groups/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "driver", role: "driver" });
  mocks.list.mockResolvedValue([]);
  mocks.action.mockResolvedValue({ message: "Accepted" });
});
it("returns private driver groups and forwards the authenticated action", async () => {
  const list = await GET();
  expect(list.status).toBe(200);
  expect(list.headers.get("cache-control")).toContain("no-store");
  const payload = { action: "accept" };
  const result = await POST(
    new Request("http://localhost/api/driver/delivery-groups", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: JSON.stringify(payload),
    }),
  );
  expect(result.status).toBe(200);
  expect(mocks.action).toHaveBeenCalledWith(
    { id: "driver", role: "driver" },
    payload,
  );
});
it("rejects cross-origin, malformed and oversized requests without running the action", async () => {
  for (const [body, origin] of [
    ["{}", "https://other.example"],
    ["{", "http://localhost"],
    ["x".repeat(10_001), "http://localhost"],
  ]) {
    const result = await POST(
      new Request("http://localhost/api/driver/delivery-groups", {
        method: "POST",
        headers: { origin },
        body,
      }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect(mocks.action).not.toHaveBeenCalled();
});
