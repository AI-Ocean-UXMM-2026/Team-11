"use server";
import {
  executeWorkflow,
  workflowActor,
  workflowSnapshot,
} from "@/lib/workflow/server";
const publicActions = new Set([
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
) {
  try {
    if (!publicActions.has(action)) return { error: "Unknown operation." };
    const actor = await workflowActor();
    const result = await executeWorkflow(actor, action, payload, key);
    return { result, data: await workflowSnapshot(actor) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The operation could not be completed. Retry with the same details.",
    };
  }
}
export async function refreshWorkspace() {
  try {
    return { data: await workflowSnapshot(await workflowActor()) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to refresh.",
    };
  }
}
