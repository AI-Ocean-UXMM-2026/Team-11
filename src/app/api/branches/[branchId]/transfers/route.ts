import { branchHistory } from "@/lib/workflow/branch-history";
import { workflowActor, WorkflowError } from "@/lib/workflow/server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const actor = await workflowActor();
    const { branchId } = await params;
    const query = new URL(request.url).searchParams;
    return Response.json(
      await branchHistory(
        actor,
        branchId,
        Number(query.get("page") ?? 1),
        Number(query.get("pageSize") ?? 25),
      ),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkflowError
            ? error.message
            : "Unable to load branch history.",
      },
      { status: error instanceof WorkflowError ? error.status : 500, headers },
    );
  }
}
