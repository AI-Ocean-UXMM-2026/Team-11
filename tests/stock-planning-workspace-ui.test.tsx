// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StockPlanning } from "../src/components/stock-planning";
import { TakeoverReport } from "../src/components/takeover-report";
import { demoData } from "../src/lib/demo-data";
import type {
  BackupPlanningDetail,
  BackupPlanningRow,
  TakeoverReportPage,
} from "../src/lib/stock-planning";

const original: BackupPlanningRow = {
  branchId: "00000000-0000-4000-8000-000000000001",
  branchName: "Hlaing",
  productId: "00000000-0000-4000-8000-000000000002",
  productName: "Premium Fine Fabric Longyi",
  variant: "Black EU 40",
  unit: "pairs",
  retail: 240,
  available: 18,
  reserved: 2,
  target: 60,
  threshold: 20,
  source: "manual",
  low: true,
  incoming: 0,
  openRefills: 0,
  proposedRefill: 42,
  recommendation: {
    eligible: false,
    quantity: null,
    from: "2026-07-01",
    to: "2026-10-01",
    completeMonths: 0,
    orders: 0,
    units: 0,
    monthlyAverage: 0,
    monthlyVariation: 0,
    leadDays: null,
    receipts: 0,
    minimumMonths: 3,
    minimumOrders: 5,
    minimumReceipts: 1,
  },
};
let root: Root,
  host: HTMLDivElement,
  client: QueryClient,
  row: BackupPlanningRow,
  detail: BackupPlanningDetail;
const fetcher = vi.fn();
const openOrder = vi.fn();
beforeEach(() => {
  openOrder.mockReset();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  row = structuredClone(original);
  detail = { row, transfers: [], takeovers: [], orders: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.stubGlobal("fetch", fetcher);
  fetcher
    .mockReset()
    .mockImplementation(async (url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Response.json({ result: { message: "Backup settings saved." } })
        : Response.json({
            data: url.includes("view=detail")
              ? detail
              : {
                  rows: [
                    row,
                    {
                      ...row,
                      branchId: "other",
                      branchName: "Insein",
                      available: 45,
                      low: false,
                    },
                  ],
                },
          }),
    );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
};
async function render(initialBranchId?: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <StockPlanning
          data={demoData}
          viewer={{ id: "hq", role: "hq", name: "HQ" }}
          demo
          updated={async () => {}}
          initialBranchId={initialBranchId}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(text: string) {
  const b = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  await act(async () => b.click());
  await settle();
  return b;
}
async function manage() {
  const b = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Manage Hlaing Black EU 40"]',
  )!;
  b.focus();
  await act(async () => b.click());
  await settle();
  return b;
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("opens the original wholesale order from the dedicated takeover report", async () => {
  const report: TakeoverReportPage = {
    page: 1,
    pageSize: 20,
    total: 1,
    rows: [
      {
        id: "handoff",
        orderId: "original-order",
        branchName: row.branchName,
        productId: row.productId,
        variant: row.variant,
        reference: "STT-original",
        quantity: 8,
        unit: "pairs",
        reason: "HQ vehicle delay",
        resolution: "Not dispatched",
        responseReason: null,
        deadline: new Date().toISOString(),
        fulfilledAt: null,
        status: "reserved",
        actor: "HQ",
        at: new Date().toISOString(),
        events: [],
      },
    ],
  };
  fetcher.mockResolvedValue(Response.json({ data: report }));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TakeoverReport
          viewer={{ id: "hq", role: "hq", name: "HQ" }}
          openOrder={openOrder}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
  await click("STT-original");
  expect(openOrder).toHaveBeenCalledWith("original-order");
  expect(host.querySelector("dialog")).toBeNull();
});
it("shows a compact overview and opens the Hlaing plan only after Manage, with focus restored on Escape", async () => {
  await render(row.branchId);
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.textContent).toContain("Retail stock");
  expect(host.textContent).not.toContain("Hlaing backup plan");
  expect(
    fetcher.mock.calls.some((c) => String(c[0]).includes("view=detail")),
  ).toBe(false);
  const trigger = await manage();
  expect(host.querySelector("dialog")?.open).toBe(true);
  expect(host.textContent).toContain("Hlaing backup plan");
  expect(host.textContent).toContain("HQ settings");
  expect(host.textContent).not.toContain("AI suggestion criteria");
  const criteria = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Show AI suggestion criteria"]',
  )!;
  await act(async () => criteria.click());
  expect(host.textContent).toContain(
    "History does not meet the minimum yet. Set the target manually.",
  );
  expect(host.textContent).not.toContain("Apply recommended target");
  expect(host.textContent).not.toContain("Emergency fulfillment");
  expect(host.textContent).not.toContain("Record takeover");
  expect(host.textContent).not.toContain("Takeover history");
  expect(host.textContent).not.toContain("Safety buffer (%)");
  await act(async () => {
    host
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(host.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("validates the alert threshold against target and saves manual settings without historical data", async () => {
  await render();
  await manage();
  const form = host.querySelector<HTMLInputElement>(
    'input[name="target"]',
  )!.form!;
  const target = form.elements.namedItem("target") as HTMLInputElement;
  const threshold = form.elements.namedItem("threshold") as HTMLInputElement;
  (form.elements.namedItem("reason") as HTMLInputElement).value =
    "Initial HQ manual reserve";
  await input(target, "60");
  await input(threshold, "61");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "no greater than the target",
  );
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
  await input(threshold, "20");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await settle();
  const sent = JSON.parse(
    fetcher.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
  );
  expect(sent).toMatchObject({
    action: "settings",
    target: 60,
    threshold: 20,
    unit: "pairs",
    source: "manual",
    reason: "Initial HQ manual reserve",
  });
  expect(sent).not.toHaveProperty("retailMove");
  expect(host.textContent).toContain("Backup settings saved.");
});
it("shows an existing refill instead of offering a duplicate and does not count it as available", async () => {
  row.openRefills = 1;
  row.incoming = 42;
  detail.transfers = [
    {
      id: "transfer",
      reference: "TR-123",
      quantity: 42,
      status: "shipping",
      createdAt: new Date().toISOString(),
      receivedAt: null,
      due: "2026-11-01",
    },
  ];
  await render();
  await click("Review open refill");
  expect(host.querySelector("#backup-settings")).toBeNull();
  expect(host.querySelector('input[name="target"]')).toBeNull();
  expect(host.textContent).toContain("Hlaing backup refill");
  expect(host.textContent).toContain("1 open backup refill");
  expect(host.textContent).toContain("In transit");
  expect(host.textContent).toContain("branch confirms physical receipt");
  expect(host.textContent).toContain(
    "Waiting for the branch to confirm physical receipt.",
  );
  expect(host.textContent).not.toContain("Confirm arrival date");
  expect(
    [...host.querySelectorAll("button")].some((b) =>
      b.textContent?.startsWith("Create refill"),
    ),
  ).toBe(false);
  expect(host.querySelector("dialog")?.textContent).toContain("18 pairs");
});
it("requires explicit HQ application of a supported recommendation", async () => {
  row.target = null;
  row.recommendation = {
    ...row.recommendation,
    eligible: true,
    quantity: 65,
    completeMonths: 3,
    orders: 8,
    receipts: 2,
    leadDays: 3,
  };
  await render();
  await manage();
  expect(
    host.querySelector<HTMLInputElement>('input[name="target"]')!.value,
  ).toBe("65");
  expect(
    host.querySelector("#backup-settings .backup-status")?.textContent,
  ).toBe("AI-assisted");
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
  const form = host.querySelector<HTMLInputElement>(
    'input[name="target"]',
  )!.form!;
  (form.elements.namedItem("reason") as HTMLInputElement).value =
    "HQ reviewed the supporting evidence";
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  await settle();
  expect(
    JSON.parse(
      fetcher.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    ),
  ).toMatchObject({ action: "settings", source: "ai", target: 65 });
});
it("filters the overview by branch without opening details", async () => {
  await render();
  const select = [...host.querySelectorAll("select")].find((s) =>
    s.closest("label")?.textContent?.startsWith("Branches"),
  )!;
  await act(async () => {
    select.value = row.branchId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.querySelector("dialog")).toBeNull();
});
