import {
  executeWorkflow,
  workflowActor,
  workflowSnapshot,
  WorkflowError,
  parseWorkspaceQuery,
} from "@/lib/workflow/server";
const actions = new Set([
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
import { samePortalOrigin } from "@/lib/workflow/origin";
import { isDemoMode } from "@/lib/supabase/config";
export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("query") ?? "{}";
    if (raw.length > 4000) throw new WorkflowError("Query too large.", 413);
    const query = parseWorkspaceQuery(JSON.parse(raw));
    return Response.json(
      {
        data: await workflowSnapshot(await workflowActor(), query),
        demo: isDemoMode(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load workspace.",
      },
      { status: error instanceof WorkflowError ? error.status : 400 },
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!samePortalOrigin(request))
      throw new WorkflowError("Submit from this portal only.", 403);
    if (Number(request.headers.get("content-length")) > 24000)
      throw new WorkflowError("Request too large.", 413);
    const body = await request.text();
    if (body.length > 24000) throw new WorkflowError("Request too large.", 413);
    const { action, payload, key, query: input = {} } = JSON.parse(body);
    const query = parseWorkspaceQuery(input);
    if (
      !actions.has(action) ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      throw new WorkflowError("Invalid operation.");
    const actor = await workflowActor();
    const result = await executeWorkflow(actor, action, payload, key);
    return Response.json(
      {
        result,
        data: await workflowSnapshot(actor, {
          ...query,
          orderId: query.orderId ?? result.orderId,
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Operation failed." },
      { status: error instanceof WorkflowError ? error.status : 400 },
    );
  }
}
