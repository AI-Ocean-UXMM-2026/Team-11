// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BranchStockMovements } from "../src/components/branch-stock-movements";
import { demoData } from "../src/lib/demo-data";
import type { WorkspaceData } from "../src/lib/domain";

const workflowAction = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const branchId = "10000000-0000-4000-8000-000000000001";
const updated = vi.fn(async () => {}),
  refresh = vi.fn(async () => {});
const pendingTransfer = {
  id: "pending",
  reference: "TR-PENDING",
  sourceBranchId: null,
  destinationBranchId: branchId,
  source: "Oceanpride Longyi HQ",
  destination: "Hlaing branch",
  productId: "product-1",
  variant: "Black · EU 38",
  quantity: 32,
  status: "shipping",
  reason: "Backup refill",
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  workflowAction.mockReset();
  updated.mockClear();
  refresh.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  const data: WorkspaceData = {
    ...structuredClone(demoData),
    query: {},
    transfers: [
      pendingTransfer,
      {
        ...pendingTransfer,
        id: "received",
        reference: "TR-RECEIVED",
        status: "received",
      },
      {
        ...pendingTransfer,
        id: "outgoing",
        reference: "TR-OUT",
        sourceBranchId: branchId,
        destinationBranchId: null,
        destination: "Oceanpride Longyi HQ",
      },
    ],
    branches: [
      {
        ...demoData.branches[0],
        id: branchId,
        name: "Hlaing branch",
        inventory: [],
      },
    ],
  };
  const viewer = {
    id: "branch-user",
    name: "Branch user",
    role: "branch" as const,
    branchId,
  };
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <BranchStockMovements
          data={data}
          viewer={viewer}
          updated={updated}
          refresh={refresh}
        />
      </QueryClientProvider>,
    ),
  );
}

it("manages only incoming transfers awaiting branch receipt confirmation", async () => {
  await render();
  expect(host.textContent).toContain("Confirm incoming physical stock here");
  expect(host.textContent).toContain("TR-PENDING");
  expect(host.textContent).not.toContain("TR-RECEIVED");
  expect(host.textContent).not.toContain("TR-OUT");
  expect(host.textContent).toContain("Confirm receipt & add stock");
  expect(host.querySelector('select[name="productId"]')).toBeNull();
  expect(host.textContent).not.toContain("Record a physical movement");
});

it("shows received physical stock records after switching to Record", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          rows: [
            {
              id: 1,
              branchId,
              branchName: "Hlaing branch",
              productId: "product-1",
              variant: "Black · EU 38",
              kind: "transfer_in",
              quantity: 32,
              reason: "TR-123: Physical receipt",
              actorName: "Branch user",
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      }),
    })),
  );
  await render();
  const recordTab = [
    ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((tab) => tab.textContent?.includes("Record"))!;
  await act(async () => recordTab.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(host.textContent).toContain("Received physical stock");
  expect(host.textContent).toContain("Physical stock received");
  expect(host.textContent).toContain("+32 pairs");
  expect(host.textContent).not.toContain("TR-PENDING");
});
