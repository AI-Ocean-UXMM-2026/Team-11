import {
  workflowActor,
  workflowList,
  parseWorkspaceQuery,
  WorkflowError,
} from "@/lib/workflow/server";
import { exportCsv } from "@/lib/workflow/exports";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    if (kind !== "orders" && kind !== "report")
      throw new WorkflowError("Invalid export.");
    const raw = url.searchParams.get("query") ?? "{}";
    if (raw.length > 4000) throw new WorkflowError("Query too large.", 413);
    const query = {
      ...parseWorkspaceQuery(JSON.parse(raw)),
      pageSize: 100 as const,
      orderId: undefined,
      ordersCutoff: new Date().toISOString(),
    };
    const actor = await workflowActor();
    // Monetary exports are only available to the owner or HQ; branch reports
    // are scoped to the caller's own retail events inside the database.
    if (kind === "orders" && !["hq", "sme"].includes(actor.role))
      throw new WorkflowError(
        "Order exports are unavailable for this role.",
        403,
      );
    const first = await workflowList(actor, kind, query, 1);
    query.reportCutoff = first.cutoff;
    const rows = exportCsv(
      kind,
      first,
      (page) => workflowList(actor, kind, query, page),
      query,
    );
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (request.signal.aborted) {
            await rows.return();
            controller.close();
            return;
          }
          const item = await rows.next();
          if (item.done) controller.close();
          else controller.enqueue(encoder.encode(item.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await rows.return();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="supplylink-${kind}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Export failed." },
      {
        status: error instanceof WorkflowError ? error.status : 400,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
