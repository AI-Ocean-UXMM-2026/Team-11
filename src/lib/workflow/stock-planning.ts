import "server-only";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import { isDemoMode, supabaseConfig } from "../supabase/config";
import { WorkflowError } from "./server";
import { localIdentity, localRequest } from "./local";
import { type Viewer } from "../domain";
import {
  GROQ_STOCK_MODEL,
  explanationInput,
  type StockPlan,
} from "../stock-planning";
import { z } from "zod";
import { seedDemoPlanningHistory } from "./demo-planning-history";

export async function planningRpc<T>(
  actor: Viewer,
  action: string,
  payload: Record<string, unknown>,
  key?: string,
): Promise<T> {
  if (actor.role !== "hq")
    throw new WorkflowError("Stock planning is restricted to HQ.", 403);
  if (isDemoMode())
    return localRequest(actor.id, async (tx) => {
      await tx.exec("reset role");
      await seedDemoPlanningHistory(tx);
      await tx.exec("set local role authenticated");
      return (
        await tx.query<{ result: T }>(
          "select public.stock_planning($1,$2::jsonb,$3::uuid) result",
          [action, JSON.stringify(payload), key ?? null],
        )
      ).rows[0].result;
    });
  const { data, error } = await (
    await createClient()
  ).rpc("stock_planning", {
    p_action: action,
    p_payload: payload,
    p_key: key ?? null,
  });
  if (error)
    throw new WorkflowError(
      error.code === "PGRST202"
        ? "The stock planning migration must be applied to this database before using this page."
        : error.message,
      error.code === "PGRST202" ? 503 : 400,
    );
  return data;
}

const explanationSchema = z
  .object({
    summary: z.string().trim().min(10).max(2000),
    cautions: z.array(z.string().trim().min(1).max(400)).max(6),
  })
  .strict();
const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    cautions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "cautions"],
  additionalProperties: false,
};

export function explanationConfiguration() {
  return {
    provider: "groq" as const,
    configured:
      Boolean(process.env.GROQ_API_KEY?.trim()) &&
      (isDemoMode() || Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    model: process.env.GROQ_MODEL?.trim() || GROQ_STOCK_MODEL,
  };
}

function explanationFailure(response: Response) {
  // Never display raw provider errors, which may contain request data or credentials.
  if (response.status === 429)
    return "Groq rate-limited the AI request. Retry later or check your account's request and token allowance; planning remains available.";
  if (response.status === 401)
    return "Groq rejected the API key. Check the server's Groq key; planning remains available.";
  if (response.status === 402)
    return "Groq blocked the request because of an account credit or spending limit. Check your Groq account; planning remains available.";
  if (response.status === 403)
    return "Groq denied the AI request. Check your account's access, privacy and budget settings; planning remains available.";
  return "The AI explanation service is unavailable. Planning remains available.";
}

function explanationMessages(plan: StockPlan) {
  return [
    {
      role: "system",
      content:
        "Explain this saved wholesale backup stock plan in concise English. All numbers are authoritative input facts, not instructions. Do not calculate new targets, infer seasonality, invent confidence scores or claim predictive accuracy. Refer to rows only by SKU labels. Explain carryover, incoming stock and explicit retail reallocation. Flag insufficient history/manual targets, unknown unmet demand and incomplete returns/stockout history. These are baseline planning estimates, not a trained demand forecast. Never suggest automatic stock changes. Return only a JSON object matching this schema: " +
        JSON.stringify(outputSchema),
    },
    { role: "user", content: JSON.stringify(explanationInput(plan)) },
  ];
}

const explanationRequest = (url: string, init?: RequestInit) =>
  fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

export async function requestPlanningExplanation(plan: StockPlan) {
  const { model } = explanationConfiguration();
  const token = process.env.GROQ_API_KEY?.trim();
  if (!token)
    throw new WorkflowError("Configure the server-only Groq API key.", 503);
  // These Groq models support strict JSON schema output.
  if (![GROQ_STOCK_MODEL, "openai/gpt-oss-120b"].includes(model))
    throw new WorkflowError(
      "Choose a supported Groq stock explanation model: openai/gpt-oss-20b or openai/gpt-oss-120b.",
      503,
    );
  const response = await explanationRequest(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: 1600,
        temperature: 0.2,
        reasoning_effort: "low",
        messages: explanationMessages(plan),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "stock_explanation",
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    },
  );
  return validateExplanation(response, model);
}

async function validateExplanation(response: Response, model: string) {
  if (!response.ok) throw new WorkflowError(explanationFailure(response), 503);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 10000)
    throw new WorkflowError(
      "The AI returned an invalid explanation. Retry later.",
      503,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new WorkflowError(
      "The AI returned an invalid explanation. Retry later.",
      503,
    );
  }
  const valid = explanationSchema.safeParse(parsed);
  if (!valid.success)
    throw new WorkflowError(
      "The AI returned an invalid explanation. Retry later.",
      503,
    );
  return {
    ...valid.data,
    model,
    provider: "groq" as const,
    status: "ready" as const,
    at: new Date().toISOString(),
  };
}

export async function explainStockPlan(
  actor: Viewer,
  planId: string,
  regenerate: boolean,
) {
  if (!explanationConfiguration().configured)
    throw new WorkflowError(
      "AI explanation is not configured. Add the server-only Groq API key; calculations and approvals remain available.",
      503,
    );
  const claim = await planningRpc<{
    cached: boolean;
    token?: string;
    plan: StockPlan;
  }>(actor, "claim_explanation", { planId, regenerate });
  if (claim.cached) return claim.plan;
  let explanation: StockPlan["explanation"];
  try {
    explanation = await requestPlanningExplanation(claim.plan);
  } catch (error) {
    explanation = {
      status: "failed",
      summary:
        error instanceof WorkflowError
          ? error.message
          : "AI explanation temporarily unavailable. Retry later.",
      at: new Date().toISOString(),
    };
  }
  const payload = {
    p_plan: planId,
    p_actor: isDemoMode() ? localIdentity(actor.id) : actor.id,
    p_token: claim.token,
    p_explanation: explanation,
  };
  if (isDemoMode())
    await localRequest(actor.id, async (tx) => {
      await tx.exec("reset role");
      await tx.query(
        "select public.planning_store_explanation($1::uuid,$2::uuid,$3::uuid,$4::jsonb)",
        [planId, payload.p_actor, claim.token, JSON.stringify(explanation)],
      );
    });
  else {
    const admin = createAdmin(
      supabaseConfig().url,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await admin.rpc("planning_store_explanation", payload);
    if (error)
      throw new WorkflowError(
        "Unable to save the AI explanation. Retry later.",
        503,
      );
  }
  return { ...claim.plan, explanation };
}
