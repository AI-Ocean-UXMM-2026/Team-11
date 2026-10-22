import { monthSchema, planningRequestSchema } from "@/lib/stock-planning";
import {
  planningRpc,
  explainStockPlan,
  explanationConfiguration,
  takeoverReportPage,
} from "@/lib/workflow/stock-planning";
import { workflowActor, WorkflowError } from "@/lib/workflow/server";
import { samePortalOrigin } from "@/lib/workflow/origin";
import { z } from "zod";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Stock planning is unavailable.",
    },
    { status: error instanceof WorkflowError ? error.status : 400, headers },
  );
}
export async function GET(request: Request) {
  try {
    const actor = await workflowActor();
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "takeovers") {
      const page = z.coerce.number().int().min(1).max(1000000).default(1).parse(params.get("page"));
      return Response.json(
        { data: await takeoverReportPage(actor, page) },
        { headers },
      );
    }
    if (params.get("view") === "overview" || params.get("view") === "detail") {
      const action = params.get("view")!;
      const payload =
        action === "detail"
          ? {
              branchId: z.uuid().parse(params.get("branchId")),
              productId: z.uuid().parse(params.get("productId")),
            }
          : {};
      return Response.json(
        {
          data: await planningRpc(actor, action, payload),
          ai: explanationConfiguration(),
        },
        { headers },
      );
    }
    const branchId = z.uuid().parse(params.get("branchId"));
    const month = monthSchema.parse(params.get("month"));
    return Response.json(
      {
        data: await planningRpc(actor, "snapshot", { branchId, month }),
        ai: explanationConfiguration(),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!samePortalOrigin(request))
      throw new WorkflowError("Request origin is not allowed.", 403);
    const actor = await workflowActor();
    if (actor.role !== "hq")
      throw new WorkflowError("Stock planning is restricted to HQ.", 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new WorkflowError("Send a JSON request.", 415);
    const text = await request.text();
    if (text.length > 24000)
      throw new WorkflowError("Planning request is too large.", 413);
    const parsed = planningRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new WorkflowError(
        parsed.error.issues[0]?.message ?? "Check the planning inputs.",
      );
    const { action, ...payload } = parsed.data;
    const result =
      action === "explain" && "planId" in payload && "regenerate" in payload
        ? await explainStockPlan(actor, payload.planId, payload.regenerate)
        : await planningRpc(
            actor,
            action,
            payload,
            "key" in payload ? payload.key : undefined,
          );
    return Response.json({ result }, { headers });
  } catch (error) {
    return failure(error);
  }
}
