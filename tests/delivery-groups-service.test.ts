import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/lib/supabase/config", () => ({ isDemoMode: () => false }));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mock.rpc }),
}));
import {
  assignDeliveryGroup,
  dispatchCandidates,
  driverDeliveryGroups,
  driverGroupAction,
} from "../src/lib/workflow/delivery-groups";
const actor = { id: randomUUID(), role: "hq" as const, name: "HQ" };
beforeEach(() => mock.rpc.mockReset());
it("gives HQ a setup-pending message for missing planner or assignment RPCs", async () => {
  mock.rpc.mockResolvedValue({
    error: { code: "PGRST202", message: "Could not find public.internal_rpc" },
  });
  await expect(dispatchCandidates(actor)).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining("setup is pending"),
  });
  await expect(
    assignDeliveryGroup(actor, {
      orderIds: [randomUUID(), randomUUID()],
      driverId: randomUUID(),
      key: randomUUID(),
    }),
  ).rejects.toMatchObject({
    status: 503,
    message: expect.not.stringContaining("public.internal_rpc"),
  });
});

it("validates driver-only actions and checked parcels before calling the database", async () => {
  await expect(driverDeliveryGroups(actor)).rejects.toMatchObject({
    status: 403,
  });
  const driver = { ...actor, role: "driver" as const };
  const runId = randomUUID();
  await expect(
    driverGroupAction(driver, {
      action: "pickup",
      runId,
      orderIds: [],
      key: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const order = randomUUID();
  await expect(
    driverGroupAction(driver, {
      action: "pickup",
      runId,
      orderIds: [order, order],
      key: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: { message: "Accepted" } });
  const key = randomUUID();
  await driverGroupAction(driver, {
    action: "accept",
    runId,
    orderIds: [],
    key,
  });
  expect(mock.rpc).toHaveBeenCalledWith("driver_delivery_group_action", {
    p_run: runId,
    p_action: "accept",
    p_orders: [],
    p_key: key,
  });
});
it("returns real candidate data and rejects customer planning before any RPC", async () => {
  const data = { orders: [], drivers: [] };
  mock.rpc.mockResolvedValue({ data });
  await expect(dispatchCandidates(actor)).resolves.toEqual(data);
  mock.rpc.mockClear();
  await expect(
    dispatchCandidates({ ...actor, role: "sme" }),
  ).rejects.toMatchObject({ status: 403 });
  expect(mock.rpc).not.toHaveBeenCalled();
});
