// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (props: any) => <img {...props} /> }));
vi.mock("../src/app/actions", () => ({
  provisionAccount: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: vi.fn() }));
vi.mock("../src/components/delivery-tracking", () => ({
  DriverTrackingNotice: () => null,
  DeliveryTracking: () => null,
}));
vi.mock("../src/components/driver-tracking-provider", () => ({
  useDriverTracking: () => ({ trip: null }),
}));
vi.mock("../src/components/location-picker", () => ({
  LocationPicker: () => null,
}));
import { Workspace } from "../src/components/workspace";
import { demoData } from "../src/lib/demo-data";
import type { Role, WorkspaceData } from "../src/lib/domain";
import { businessDate } from "../src/lib/domain";
let host: HTMLDivElement, root: Root, client: QueryClient, data: WorkspaceData;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  data = structuredClone(demoData);
  data.orders = [];
  data.attentionOrders = [];
  const today = businessDate(new Date().toISOString());
  data.query = {
    reportFrom: today.slice(0, 7) + "-01",
    reportTo: today,
    reportChannel: "All channels",
  };
  data.refillRequests = [
    {
      id: "request",
      branchId: "branch-a",
      branchName: "Hlaing branch",
      productId: "sku-a",
      variant: "Black · EU 38",
      onHand: 9,
      threshold: 10,
      incoming: 12,
      createdAt: "2026-10-22T06:00:00Z",
    },
  ];
  data.refillRequestCount = 1;
  data.summary = {
    orders: 0,
    active: 0,
    awaiting: 0,
    held: 0,
    shipping: 0,
    wholesale: 0,
    retail: 0,
    retailCount: 0,
    pendingTransfers: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(role: Role) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Workspace
          data={data}
          viewer={{
            id: role,
            name: "Test user",
            role,
            branchId: role === "branch" ? "branch-a" : null,
          }}
          demo
          section="help"
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('[aria-label^="Notifications,"]')!
      .click();
  });
}
it("includes automatic refill requests in the HQ bell count and links to the affected branch", async () => {
  await mount("hq");
  expect(
    host.querySelector('[aria-label="Notifications, 1 action items"]'),
  ).not.toBeNull();
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Automatic refill requested");
  expect(dialog.textContent).toContain("9 pairs on hand · below 10");
  expect(dialog.textContent).toContain("12 pairs in pending refills");
  expect(dialog.querySelector('a[href="/branches/branch-a"]')).not.toBeNull();
  expect(dialog.textContent).not.toContain("You’re all caught up");
});
it("keeps HQ refill notifications out of other role notification lists", async () => {
  await mount("driver");
  expect(
    host.querySelector('[aria-label="Notifications, 0 action items"]'),
  ).not.toBeNull();
  expect(host.querySelector("dialog")?.textContent).not.toContain(
    "Automatic refill requested",
  );
});

it("identifies a backup reserve shortage separately from total on-hand stock", async () => {
  data.refillRequests![0] = {
    ...data.refillRequests![0],
    pool: "backup",
    onHand: 16,
    threshold: 80,
  };
  await mount("hq");
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Wholesale backup refill requested");
  expect(dialog.textContent).toContain("16 pairs in backup · below 80");
});
