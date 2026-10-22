import "server-only";
import { z } from "zod";
import type { Viewer } from "../domain";
import type {
  DispatchCandidates,
  DriverDeliveryGroup,
  DriverGroupResult,
} from "../delivery-groups";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest } from "./local";
import { WorkflowError } from "./server";
import { notifyDemoTracking } from "./tracking-events";

export const groupAssignmentSchema = z
  .object({
    orderIds: z
      .array(z.string().uuid())
      .min(2)
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
    driverId: z.string().uuid(),
    key: z.string().uuid(),
  })
  .strict();

function planningRpcError(error: { code?: string; message: string }) {
  return error.code === "PGRST202"
    ? new WorkflowError(
        "Grouped delivery setup is pending. Please contact your system administrator to apply the database update.",
        503,
      )
    : new WorkflowError(error.message);
}

export async function dispatchCandidates(
  actor: Viewer,
): Promise<DispatchCandidates> {
  if (!["hq", "branch"].includes(actor.role))
    throw new WorkflowError(
      "Only HQ or branch staff can plan deliveries.",
      403,
    );
  if (isDemoMode())
    return localRequest(
      actor.id,
      async (tx) =>
        (
          await tx.query<{ data: DispatchCandidates }>(
            "select public.delivery_dispatch_candidates() data",
          )
        ).rows[0].data,
    );
  const { data, error } = await (
    await createClient()
  ).rpc("delivery_dispatch_candidates");
  if (error) throw planningRpcError(error);
  return data;
}

export async function assignDeliveryGroup(actor: Viewer, input: unknown) {
  if (!["hq", "branch"].includes(actor.role))
    throw new WorkflowError(
      "Only HQ or branch staff can plan deliveries.",
      403,
    );
  const parsed = groupAssignmentSchema.safeParse(input);
  if (!parsed.success)
    throw new WorkflowError(
      "Choose a driver and two to eight distinct orders.",
    );
  const { orderIds, driverId, key } = parsed.data;
  let result: { runId: string; message: string };
  if (isDemoMode()) {
    try {
      result = await localRequest(
        actor.id,
        async (tx) =>
          (
            await tx.query<{ data: typeof result }>(
              "select public.delivery_group_assign($1::uuid[],$2::uuid,$3::uuid) data",
              [orderIds, driverId, key],
            )
          ).rows[0].data,
      );
    } catch (error) {
      throw new WorkflowError(
        error instanceof Error ? error.message : "Group assignment failed.",
      );
    }
    notifyDemoTracking();
  } else {
    const { data, error } = await (
      await createClient()
    ).rpc("delivery_group_assign", {
      p_orders: orderIds,
      p_driver: driverId,
      p_key: key,
    });
    if (error) throw planningRpcError(error);
    result = data;
  }
  return result;
}

export const driverGroupActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("accept"),
      runId: z.string().uuid(),
      orderIds: z.array(z.string().uuid()).length(0),
      key: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pickup"),
      runId: z.string().uuid(),
      orderIds: z
        .array(z.string().uuid())
        .min(1)
        .max(8)
        .refine((ids) => new Set(ids).size === ids.length),
      key: z.string().uuid(),
    })
    .strict(),
]);

function requireDriver(actor: Viewer) {
  if (actor.role !== "driver")
    throw new WorkflowError(
      "Only drivers can update their pickup groups.",
      403,
    );
}
export async function driverDeliveryGroups(
  actor: Viewer,
): Promise<DriverDeliveryGroup[]> {
  requireDriver(actor);
  if (isDemoMode())
    return localRequest(
      actor.id,
      async (tx) =>
        (
          await tx.query<{ data: DriverDeliveryGroup[] }>(
            "select public.driver_delivery_groups() data",
          )
        ).rows[0].data,
    );
  const { data, error } = await (
    await createClient()
  ).rpc("driver_delivery_groups");
  if (error) throw planningRpcError(error);
  return data;
}
export async function driverGroupAction(
  actor: Viewer,
  input: unknown,
): Promise<DriverGroupResult> {
  requireDriver(actor);
  const parsed = driverGroupActionSchema.safeParse(input);
  if (!parsed.success)
    throw new WorkflowError(
      "Choose a delivery group and check the parcels you collected.",
    );
  const { runId, action, orderIds, key } = parsed.data;
  if (isDemoMode()) {
    try {
      const result = await localRequest(
        actor.id,
        async (tx) =>
          (
            await tx.query<{ data: DriverGroupResult }>(
              "select public.driver_delivery_group_action($1::uuid,$2,$3::uuid[],$4::uuid) data",
              [runId, action, orderIds, key],
            )
          ).rows[0].data,
      );
      notifyDemoTracking();
      return result;
    } catch (error) {
      throw new WorkflowError(
        error instanceof Error ? error.message : "Group pickup failed.",
      );
    }
  }
  const { data, error } = await (
    await createClient()
  ).rpc("driver_delivery_group_action", {
    p_run: runId,
    p_action: action,
    p_orders: orderIds,
    p_key: key,
  });
  if (error) throw planningRpcError(error);
  return data;
}
