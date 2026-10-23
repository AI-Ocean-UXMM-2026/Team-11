// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PhasedFulfilment } from "../src/components/phased-fulfilment";
import { demoData } from "../src/lib/demo-data";
import type { Order, Branch } from "../src/lib/domain";
let root: Root, host: HTMLDivElement, order: Order, branch: Branch;
const run = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  run.mockReset();
  order = {
    ...demoData.orders[0],
    status: "Confirmed",
    items: 60,
    workflow: {
      receiver: "Receiver",
      phone: "09123456789",
      notes: "",
      paymentVerified: true,
      reserved: true,
      hqComplete: false,
      received: false,
      issue: null,
      refundRequired: false,
      instructions: "",
      driverId: null,
      driverName: null,
      handover: false,
      lines: [
        {
          productId: "black",
          name: "Premium Fine Fabric Longyi",
          variant: "Black · EU 40",
          quantity: 60,
        },
      ],
      evidence: [],
      events: [],
    },
  };
  branch = {
    id: "branch",
    name: "Hlaing",
    address: "",
    manager: "",
    sales: 0,
    stock: 40,
    lowStock: 0,
    active: true,
    inventory: [
      {
        productId: "black",
        variant: "Black · EU 40",
        onHand: 40,
        protected: 40,
        allocated: 0,
      },
    ],
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  role: "hq" | "sme" = "hq",
  branches: Branch[] = [branch],
) {
  await act(async () =>
    root.render(
      <PhasedFulfilment
        order={order}
        viewer={{ id: role, role, name: role }}
        branches={branches}
        pending={false}
        act={run}
      />,
    ),
  );
}
it("caps phase 1 at the branch’s available 40 pairs and sends only those pairs for acceptance", async () => {
  await render();
  const select = host.querySelector("select")!;
  expect(select.value).toBe("branch");
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(input.value).toBe("40");
  expect(input.max).toBe("40");
  expect(host.textContent).toContain("60 outstanding · 40 available");
  expect(host.textContent).toContain("Phased delivery · 40 pairs");
  expect(host.textContent).not.toContain(
    "The nearest branch with available backup",
  );
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, "Available stock phase one");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = host.querySelector<HTMLButtonElement>(".button.primary")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(run).toHaveBeenCalledWith("phase_request", {
    branchId: "branch",
    lines: [{ productId: "black", quantity: 40 }],
    reason: "Available stock phase one",
  });
});
it("sends a branch phase when no optional reason is entered", async () => {
  await render();
  const button = host.querySelector<HTMLButtonElement>(".button.primary")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(run).toHaveBeenCalledWith("phase_request", {
    branchId: "branch",
    lines: [{ productId: "black", quantity: 40 }],
    reason: "Hlaing phase planned for 40 pairs.",
  });
});
it("recommends a full branch delivery when backup covers the outstanding order", async () => {
  branch.inventory![0].protected = 60;
  branch.inventory![0].onHand = 60;
  await render();
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = "branch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("Full delivery");
  expect(
    host.querySelector<HTMLButtonElement>(".button.primary")!.textContent,
  ).toContain("Request full branch delivery");
});
it("preselects the nearest branch with backup and updates the plan when changed", async () => {
  order.pin = { latitude: 16.8, longitude: 96.15 };
  branch.pin = { latitude: 16.801, longitude: 96.15 };
  const fartherBranch: Branch = {
    ...branch,
    id: "far-branch",
    name: "Far branch",
    pin: { latitude: 16.82, longitude: 96.15 },
    inventory: [
      {
        productId: "black",
        variant: "Black · EU 40",
        onHand: 60,
        protected: 60,
        allocated: 0,
      },
    ],
  };
  await render("hq", [branch, fartherBranch]);
  const select = host.querySelector("select")!;
  expect(select.value).toBe("branch");
  expect(host.textContent).toContain("Phased delivery · 40 pairs");

  await act(async () => {
    select.value = "far-branch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("Full delivery");
  expect(
    host.querySelector<HTMLInputElement>('input[type="number"]')!.value,
  ).toBe("60");
});
it("offers phase planning after HQ cancels a returned-consignment handoff", async () => {
  order.status = "On hold";
  order.workflow!.issue = "Branch handoff";
  order.workflow!.replacementRequired = true;
  order.workflow!.dispatched = true;
  await render();
  expect(host.textContent).not.toContain(
    "original consignment must be physically returned to HQ",
  );
  expect(host.textContent).toContain("Arrange fulfilment in phases");
});
it("requires HQ to confirm the original return before suggesting a replacement phase", async () => {
  order.status = "On hold";
  order.workflow!.issue = "HQ delivery delayed";
  order.workflow!.dispatched = true;
  await render();
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = "branch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = host.querySelector<HTMLButtonElement>(".button.primary")!;
  expect(button.disabled).toBe(true);
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  await act(async () => checkbox.click());
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, "Return the first delivery to HQ");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(run).toHaveBeenCalledWith("phase_request", {
    branchId: "branch",
    lines: [{ productId: "black", quantity: 40 }],
    reason: "Return the first delivery to HQ",
    returnedConsignmentConfirmed: true,
  });
});
it("shows 40 of 60 received and phase 2 Shipping separately from the remaining order", async () => {
  order.status = "Order remaining";
  order.workflow!.fulfilment = {
    ordered: 60,
    received: 40,
    remaining: 20,
    deliveryStatus: "Shipping",
    current: {
      id: "phase2",
      number: 2,
      state: "dispatched",
      sourceBranchId: null,
      source: "Oceanpride Longyi HQ",
      pairs: 20,
      received: false,
      attemptId: "attempt",
      lines: [
        {
          productId: "black",
          name: "Premium Fine Fabric Longyi",
          variant: "Black · EU 40",
          quantity: 20,
        },
      ],
    },
    history: [
      {
        id: "phase1",
        number: 1,
        source: "Hlaing",
        state: "received",
        pairs: 40,
        received: true,
        handover: true,
        completedAt: "2026-10-22T12:00:00Z",
      },
    ],
    lines: [
      {
        productId: "black",
        name: "Premium Fine Fabric Longyi",
        variant: "Black · EU 40",
        ordered: 60,
        received: 40,
      },
    ],
  };
  await render("sme");
  expect(host.textContent).toContain("40 of 60 pairs");
  expect(host.textContent).toContain("20 pairs");
  expect(host.textContent).toContain("Order remaining");
  expect(host.textContent).toContain("Phase 2 · 20 pairs");
  expect(host.textContent).toContain("Oceanpride Longyi HQ · Shipping");
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).not.toContain("HQ completion");
});
