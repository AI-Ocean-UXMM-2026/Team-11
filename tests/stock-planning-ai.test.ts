import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/workflow/local", () => ({
  localRequest: vi.fn(),
  localIdentity: (v: string) => v,
}));
vi.mock("../src/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../src/lib/workflow/server", () => ({
  WorkflowError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
import {
  explanationConfiguration,
  requestPlanningExplanation,
} from "../src/lib/workflow/stock-planning";
import { GROQ_STOCK_MODEL, type StockPlan } from "../src/lib/stock-planning";
const fetcher = vi.fn();
const plan = {
  month: "2026-11-01",
  buffer: 20,
  minMonths: 3,
  minOrders: 5,
  rows: [
    {
      productId: "private-product",
      variant: "Private label",
      reason: "Sensitive customer reason",
      target: 80,
      carryover: 16,
      incoming: 10,
      retailMove: 0,
      refill: 54,
      backupUnits: 200,
      backupOrders: 8,
      retailUnits: 120,
      completeMonths: 3,
      stockoutDays: 0,
      manual: false,
    },
  ],
} as StockPlan;
beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "private-groq-test-key");
  vi.stubEnv("GROQ_MODEL", "");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});

it("calls Groq directly with its own key, strict schema and anonymous aggregates", async () => {
  vi.stubEnv("GROQ_API_KEY", "private-groq-test-key");
  vi.stubEnv("GROQ_MODEL", "");
  fetcher.mockResolvedValueOnce(
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "The saved target requires 54 additional pairs.",
              cautions: ["Baseline estimate only."],
            }),
          },
        },
      ],
    }),
  );
  expect(explanationConfiguration()).toMatchObject({
    provider: "groq",
    model: GROQ_STOCK_MODEL,
  });
  const result = await requestPlanningExplanation(plan);
  expect(result).toMatchObject({
    status: "ready",
    provider: "groq",
    model: GROQ_STOCK_MODEL,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
  expect(init.headers.Authorization).toBe("Bearer private-groq-test-key");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    model: GROQ_STOCK_MODEL,
    max_completion_tokens: 1600,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: { strict: true, schema: { additionalProperties: false } },
    },
  });
  expect(body).not.toHaveProperty("provider");
  expect(body).not.toHaveProperty("tools");
  for (const secret of [
    "private-product",
    "Private label",
    "Sensitive customer reason",
    "private-groq-test-key",
  ])
    expect(init.body).not.toContain(secret);
});

it("requires a Groq key and rejects unsupported models before sending data", async () => {
  vi.stubEnv("GROQ_API_KEY", "");
  expect(explanationConfiguration().configured).toBe(false);
  await expect(requestPlanningExplanation(plan)).rejects.toThrow(
    /Groq API key/,
  );
  vi.stubEnv("GROQ_API_KEY", "private-groq-test-key");
  vi.stubEnv("GROQ_MODEL", "unknown/model");
  await expect(requestPlanningExplanation(plan)).rejects.toThrow(
    /supported Groq/,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  [401, "rejected the API key"],
  [402, "credit or spending limit"],
  [403, "denied the AI request"],
  [429, "rate-limited"],
  [503, "service is unavailable"],
] as const)(
  "handles Groq HTTP %s safely with no provider fallback",
  async (status, expected) => {
    vi.stubEnv("GROQ_API_KEY", "private-groq-test-key");
    vi.stubEnv("GROQ_MODEL", "");
    fetcher.mockResolvedValueOnce(
      Response.json(
        { error: { message: "private-groq-test-key" } },
        { status },
      ),
    );
    const failure = await requestPlanningExplanation(plan).catch(
      (error: Error) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("private-groq-test-key");
    expect((failure as Error).message).toContain(expected);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("rejects malformed, refused and oversized Groq output before storage", async () => {
  for (const content of [
    undefined,
    "not JSON",
    "x".repeat(10001),
    JSON.stringify({ target: 999999 }),
    JSON.stringify({ summary: "short", cautions: [] }),
    JSON.stringify({
      summary: "An otherwise valid summary",
      cautions: [],
      target: 999999,
    }),
  ]) {
    fetcher
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content } }] }),
      );
    await expect(requestPlanningExplanation(plan)).rejects.toThrow(
      /invalid explanation/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
