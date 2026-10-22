import { workflowActor, WorkflowError } from "@/lib/workflow/server";
import {
  driverDeliveryGroups,
  driverGroupAction,
} from "@/lib/workflow/delivery-groups";
import { samePortalOrigin } from "@/lib/workflow/origin";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkflowError
          ? error.message
          : "Group pickup is unavailable.",
    },
    { status: error instanceof WorkflowError ? error.status : 503, headers },
  );
}
export async function GET() {
  try {
    return Response.json(
      { data: await driverDeliveryGroups(await workflowActor()) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!samePortalOrigin(request))
      throw new WorkflowError(
        "Use the group pickup controls in this app.",
        403,
      );
    const actor = await workflowActor();
    const text = await request.text();
    if (text.length > 10_000)
      throw new WorkflowError("This request is too large.");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new WorkflowError("Invalid group pickup request.");
    }
    return Response.json(
      { data: await driverGroupAction(actor, input) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
