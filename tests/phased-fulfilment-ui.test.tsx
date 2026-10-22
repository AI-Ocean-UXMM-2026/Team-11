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
          name: "STT Sneaker",
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
async function render(role: "hq" | "sme" = "hq") {
  await act(async () =>
    root.render(
      <PhasedFulfilment
        order={order}
        viewer={{ id: role, role, name: role }}
        branches={[branch]}
        pending={false}
        act={run}
      />,
    ),
  );
}
it("caps phase 1 at the branch’s available 40 pairs and sends only those pairs for acceptance", async () => {
  await render();
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = "branch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(input.value).toBe("40");
  expect(input.max).toBe("40");
  expect(host.textContent).toContain("60 outstanding · 40 available");
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
      source: "STT Yangon HQ",
      pairs: 20,
      received: false,
      attemptId: "attempt",
      lines: [
        {
          productId: "black",
          name: "STT Sneaker",
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
        name: "STT Sneaker",
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
  expect(host.textContent).toContain("STT Yangon HQ · Shipping");
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).not.toContain("HQ completion");
});
