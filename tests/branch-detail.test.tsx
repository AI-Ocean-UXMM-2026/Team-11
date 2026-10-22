// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { BranchDetail } from "../src/components/branch-detail";
import { BranchNetwork } from "../src/components/branch-network";
import { demoData } from "../src/lib/demo-data";
import type { WorkspaceData } from "../src/lib/domain";
const action = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: action }));
vi.mock("next/image", () => ({
  default: ({ sizes: _sizes, ...props }: any) => <img {...props} />,
}));
vi.mock("../src/components/location-picker", () => ({
  LocationPicker: () => <span>Location picker</span>,
}));
vi.mock("../src/components/location-link", () => ({
  LocationLink: () => <button>View branch location</button>,
}));
let root: Root, host: HTMLDivElement, client: QueryClient, data: WorkspaceData;
const branchId = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const updated = vi.fn(async () => {}),
  fetcher = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  data = structuredClone(demoData);
  data.branches = [
    {
      id: branchId,
      name: "Hlaing branch",
      address: "Yangon",
      manager: "Nandar Win",
      stock: 60,
      sales: 0,
      lowStock: 0,
      active: true,
      staffCount: 1,
      inventory: data.products.map((p) => ({
        productId: p.id,
        variant: p.pack,
        onHand: 10,
        allocated: 2,
        protected: 2,
      })),
    },
    {
      id: other,
      name: "Other branch",
      address: "Yangon",
      manager: "Other",
      stock: 0,
      sales: 0,
      lowStock: 0,
      active: true,
    },
  ];
  data.accounts = [
    {
      id: "assigned",
      name: "Assigned Driver",
      username: "assigned",
      role: "driver",
      status: "Active",
      affiliation: "Hlaing",
      branchId,
    },
    {
      id: "foreign",
      name: "Other Branch Driver",
      username: "foreign",
      role: "driver",
      status: "Active",
      affiliation: "Other",
      branchId: other,
    },
  ];
  fetcher.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({
      rows: [],
      pending: 0,
      pagination: { page: 1, pageSize: 25, total: 0 },
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  action
    .mockReset()
    .mockResolvedValue({ data, result: { message: "Refill reserved." } });
  updated.mockClear();
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
async function mount() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <BranchDetail
          data={data}
          viewer={{ id: "hq", name: "HQ", role: "hq" }}
          demo
          branchId={branchId}
          updated={updated}
        />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}
it("links Manage branch to a dedicated branch URL", async () => {
  await act(async () =>
    root.render(<BranchNetwork data={data} updated={updated} />),
  );
  const links = [...host.querySelectorAll("a")].filter((a) =>
    a.textContent?.includes("Manage branch"),
  );
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    `/branches/${branchId}`,
    `/branches/${other}`,
  ]);
  expect(host.textContent).not.toContain("Manage location");
});
it("shows only the selected branch, its stock and its assigned drivers", async () => {
  await mount();
  expect(host.textContent).toContain("Branch information");
  expect(host.textContent).toContain("Stock units");
  expect(host.textContent).toContain("Assigned Driver");
  expect(host.textContent).not.toContain("Other Branch Driver");
  expect(host.textContent).not.toContain("Other branch");
  expect(fetcher).toHaveBeenCalledWith(
    `/api/branches/${branchId}/transfers?page=1&pageSize=25`,
    expect.objectContaining({ cache: "no-store" }),
  );
});
it("reserves a refill for the selected branch and refreshes its history", async () => {
  await mount();
  await click("Refill stock");
  const dialog = host.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  (dialog.querySelector("[name=quantity]") as HTMLInputElement).value = "6";
  (dialog.querySelector("[name=reason]") as HTMLInputElement).value =
    "Weekly refill";
  await act(async () => {
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(action).toHaveBeenCalledWith(
    "transfer_create",
    {
      productId: data.products[0].id,
      quantity: 6,
      reason: "Weekly refill",
      sourceBranchId: "",
      destinationBranchId: branchId,
    },
    expect.any(String),
    {},
  );
  expect(updated).toHaveBeenCalledOnce();
  expect(host.querySelector("dialog")).toBeNull();
  expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  expect(host.textContent).toContain("60");
});
it("does not submit a refill above available HQ stock", async () => {
  await mount();
  await click("Refill stock");
  const form = host.querySelector("dialog form")!;
  (form.querySelector("[name=quantity]") as HTMLInputElement).value = "1000000";
  (form.querySelector("[name=reason]") as HTMLInputElement).value = "Overstock";
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(action).not.toHaveBeenCalled();
  expect(host.textContent).toContain("within the available source stock");
});
