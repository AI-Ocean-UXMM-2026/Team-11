"use server";
import {
  executeWorkflow,
  workflowActor,
  workflowSnapshot,
  parseWorkspaceQuery,
} from "@/lib/workflow/server";
import type { WorkspaceQuery } from "@/lib/workflow/query";
const publicActions = new Set([
  "phase_request",
  "phase_cancel",
  "backup_configure",
  "branch_create",
  "branch_update",
  "branch_close",
  "driver_affiliation",
  "transfer_create",
  "transfer_dispatch",
  "transfer_receive",
  "transfer_cancel",
  "route_branch",
  "handoff_accept",
  "handoff_decline",
  "handoff_cancel",
  "create",
  "retail",
  "configure",
  "stock",
  "price",
  "review_payment",
  "confirm",
  "assign",
  "prepare",
  "dispatch",
  "pickup",
  "handover",
  "receive",
  "complete",
  "hold",
  "resolve",
  "cancel",
]);
export async function workflowAction(
  action: string,
  payload: Record<string, unknown>,
  key: string,
  input: WorkspaceQuery = {},
) {
  try {
    const query = parseWorkspaceQuery(input);
    if (!publicActions.has(action)) return { error: "Unknown operation." };
    const actor = await workflowActor();
    const result = await executeWorkflow(actor, action, payload, key);
    return {
      result,
      data: await workflowSnapshot(actor, {
        ...query,
        orderId: query.orderId ?? result.orderId,
      }),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The operation could not be completed. Retry with the same details.",
    };
  }
}
