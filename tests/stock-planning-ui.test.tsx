// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonthlyPlanner } from "../src/components/stock-planning-versions";
import { nextPlanningMonth } from "../src/lib/stock-planning";
let root: Root, host: HTMLDivElement, client: QueryClient;
const fetcher = vi.fn();
const row = {
  configuredTarget: null as number | null,
  productId: "00000000-0000-4000-8000-000000000001",
  variant: "EU 40 Black",
  onHand: 100,
  allocated: 4,
  carryover: 16,
  retailAvailable: 80,
  incoming: 10,
  retailUnits: 50,
  backupUnits: 0,
  backupOrders: 0,
  completeMonths: 0,
  stockoutDays: 0,
  refillLeadDays: null,
  baseline: null,
  target: null,
  manual: false,
  retailMove: 0,
  reason: "",
  refill: null,
};
function snapshot(saved = false, approved = false, failed = false) {
  return {
    data: {
      month: nextPlanningMonth(),
      historyFrom: "2026-07-01",
      historyTo: "2026-10-01",
      coverageSince: new Date().toISOString(),
      current: [row],
      incoming: [],
      unmet: [],
      plans: saved
        ? [
            {
              id: "plan",
              branchId: "branch",
              month: nextPlanningMonth(),
              version: 1,
              status: approved ? "approved" : "draft",
              createdAt: new Date().toISOString(),
              approvedAt: null,
              buffer: 20,
              minMonths: 3,
              minOrders: 5,
              rows: [
                {
                  ...row,
                  target: approved ? 80 : null,
                  retailMove: approved ? 10 : 0,
                },
              ],
              explanation: failed
                ? {
                    status: "failed",
                    summary: "Groq rate-limited the AI request.",
                  }
                : { status: "none" },
            },
          ]
        : [],
    },
    ai: { configured: failed, model: "openai/gpt-oss-20b" },
  };
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  row.configuredTarget = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function render(saved = false, approved = false, failed = false) {
  fetcher.mockImplementation(async (_url, options) =>
    options?.method === "POST"
      ? Response.json({ result: { id: "new-plan" } })
      : Response.json(snapshot(saved, approved, failed)),
  );
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MonthlyPlanner
          branchId="branch"
          month={nextPlanningMonth()}
          viewer={{ id: "hq", role: "hq", name: "HQ" }}
          demo
          updated={async () => {}}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
it("shows honest missing-history inputs, and generation remains separate from approval", async () => {
  await render();
  expect(host.textContent).toContain("Insufficient history");
  expect(host.textContent).toContain("80 retail available · 4 allocated");
  expect(host.textContent).toContain("No stock changes until HQ approves");
  const form = host.querySelector('input[name="buffer"]')!.closest("form")!;
  const target = host.querySelector<HTMLInputElement>(
    `input[name="target-${row.productId}"]`,
  )!;
  const reason = host.querySelector<HTMLInputElement>(
    `input[name="reason-${row.productId}"]`,
  )!;
  target.value = "80";
  reason.value = "Initial branch target";
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  const sent = fetcher.mock.calls
    .filter((c) => c[1]?.method === "POST")
    .map((c) => JSON.parse(c[1].body));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    action: "generate",
    buffer: 20,
    overrides: [{ target: 80, retailMove: 0, reason: "Initial branch target" }],
  });
});

it("shows a saved provider failure as unavailable with a retry action, not a completed explanation", async () => {
  await render(true, false, true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Explanation unavailable.",
  );
  expect(host.textContent).toContain("Groq rate-limited");
  expect(host.textContent).toContain("at least one minute");
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry explanation",
  );
  expect(retry?.disabled).toBe(false);
});
it("blocks approval of unresolved targets and exposes absent AI configuration without a fake explanation", async () => {
  await render(true);
  const approve = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Approve branch plan"),
  )!;
  expect(approve.disabled).toBe(true);
  expect(host.textContent).toContain("AI setup needed");
  const explain = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Generate explanation"),
  )!;
  expect(explain.disabled).toBe(true);
  expect(host.textContent).toContain("Needs target");
});
it("does not repeat an already-approved retail reallocation when generating the next version", async () => {
  await render(true, true);
  expect(
    host.querySelector<HTMLInputElement>(`input[name="move-${row.productId}"]`)!
      .value,
  ).toBe("0");
  expect(host.textContent).toContain("Saved plan · approved");
});

it("prefills the HQ-configured starting target when the historical baseline is unavailable", async () => {
  row.configuredTarget = 80;
  await render();
  expect(
    host.querySelector<HTMLInputElement>(
      `input[name="target-${row.productId}"]`,
    )!.value,
  ).toBe("80");
  expect(host.textContent).toContain("HQ configured starting target");
});
