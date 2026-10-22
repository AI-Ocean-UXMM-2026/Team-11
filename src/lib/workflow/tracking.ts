import "server-only";
import { z } from "zod";
import type { Viewer } from "../domain";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest } from "./local";
import { WorkflowError } from "./server";
import { locationUpdateSchema, type DeliveryTracking } from "../tracking";
import { notifyDemoTracking } from "./tracking-events";

export async function deliveryTracking(
  actor: Viewer,
  orderId: string,
): Promise<DeliveryTracking> {
  if (!z.string().uuid().safeParse(orderId).success)
    throw new WorkflowError("Invalid delivery.");
  if (isDemoMode())
    return localRequest(
      actor.id,
      async (tx) =>
        (
          await tx.query<{ result: DeliveryTracking }>(
            "select public.workflow_tracking($1::uuid) as result",
            [orderId],
          )
        ).rows[0].result,
    );
  const { data, error } = await (
    await createClient()
  ).rpc("workflow_tracking", { p_order: orderId });
  if (error)
    throw new WorkflowError(
      "This delivery's location is unavailable to this account.",
      403,
    );
  return data;
}

export async function publishLocation(
  actor: Viewer,
  orderId: string,
  input: unknown,
): Promise<DeliveryTracking> {
  const parsed = locationUpdateSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(orderId).success)
    throw new WorkflowError("Invalid location update.");
  if (actor.role !== "driver")
    throw new WorkflowError(
      "Only the assigned driver can share location.",
      403,
    );
  const update = parsed.data;
  if (isDemoMode()) {
    try {
      await localRequest(actor.id, (tx) =>
        tx.query(
          "select public.workflow_tracking_publish($1::uuid,$2::uuid,$3::text,$4::jsonb)",
          [
            orderId,
            update.attemptId,
            update.state,
            JSON.stringify(update.point ?? null),
          ],
        ),
      );
    } catch (error) {
      throw new WorkflowError(
        error instanceof Error ? error.message : "Location update refused.",
        409,
      );
    }
    // A fix may update several authorized stops in one delivery group.
    notifyDemoTracking();
  } else {
    const { error } = await (
      await createClient()
    ).rpc("workflow_tracking_publish", {
      p_order: orderId,
      p_attempt: update.attemptId,
      p_state: update.state,
      p_point: update.point ?? null,
    });
    if (error) throw new WorkflowError(error.message, 409);
  }
  return deliveryTracking(actor, orderId);
}
