import {
  presentPortalData,
  workflowActor,
  WorkflowError,
} from "@/lib/workflow/server";
import { deliveryTracking, publishLocation } from "@/lib/workflow/tracking";
import { samePortalOrigin } from "@/lib/workflow/origin";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Tracking unavailable." },
    {
      status: error instanceof WorkflowError ? error.status : 403,
      headers,
    },
  );
}
export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(
      {
        data: presentPortalData(
          await deliveryTracking(
            await workflowActor(),
            (await context.params).id,
          ),
        ),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!samePortalOrigin(request))
      throw new WorkflowError("Submit from this portal only.", 403);
    if (Number(request.headers.get("content-length")) > 2000)
      throw new WorkflowError("Location update too large.", 413);
    const body = await request.text();
    if (body.length > 2000)
      throw new WorkflowError("Location update too large.", 413);
    const actor = await workflowActor();
    return Response.json(
      {
        data: presentPortalData(
          await publishLocation(
            actor,
            (await context.params).id,
            JSON.parse(body),
          ),
        ),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
