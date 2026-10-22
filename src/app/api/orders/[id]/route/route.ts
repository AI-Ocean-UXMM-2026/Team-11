import { deliveryRoadRoute } from "@/lib/workflow/routing";
import {
  presentPortalData,
  workflowActor,
  WorkflowError,
} from "@/lib/workflow/server";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const data = await deliveryRoadRoute(
      await workflowActor(),
      (await context.params).id,
      `${new URL(request.url).origin}/`,
    );
    return Response.json({ data: presentPortalData(data) }, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkflowError
            ? error.message
            : "Road routing is unavailable.",
      },
      { status: error instanceof WorkflowError ? error.status : 503, headers },
    );
  }
}
