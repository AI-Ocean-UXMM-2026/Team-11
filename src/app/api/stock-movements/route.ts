import { z } from "zod";
import { workflowActor, WorkflowError } from "@/lib/workflow/server";
import { branchStockMovementHistory } from "@/lib/workflow/stock-movements";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Stock movements are unavailable.",
    },
    { status: error instanceof WorkflowError ? error.status : 400, headers },
  );
}

export async function GET(request: Request) {
  try {
    const actor = await workflowActor();
    if (actor.role !== "branch" || !actor.branchId)
      throw new WorkflowError(
        "Stock movements are available to branch accounts.",
        403,
      );
    const params = new URL(request.url).searchParams;
    const branch = params.get("branch") ?? "";
    const branchId = branch ? z.uuid().parse(branch) : actor.branchId;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .default(1)
      .parse(params.get("page"));
    const data = await branchStockMovementHistory(actor, branchId, page);
    return Response.json({ data }, { headers });
  } catch (error) {
    return failure(error);
  }
}
