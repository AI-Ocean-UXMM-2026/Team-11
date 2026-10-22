// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SmeOrdersTable } from "../src/components/sme-orders-table";
import { OrderWorkflow } from "../src/components/order-workflow";
import { demoData } from "../src/lib/demo-data";
import type { Order, Role } from "../src/lib/domain";

const action = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: action }));
vi.mock("../src/components/driver-tracking-provider", () => ({
  useDriverTracking: () => ({ trip: null }),
}));
vi.mock("../src/components/delivery-tracking", () => ({
  DeliveryTracking: () => null,
}));
vi.mock("../src/components/payment-destinations", () => ({
  PaymentDestinations: () => <p>Receiving account details</p>,
}));
let root: Root, host: HTMLDivElement, order: Order;
const openOrder = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  openOrder.mockClear();
  action.mockReset();
  order = {
    ...demoData.orders[0],
    business: "My private shop",
    location: "My shop address",
    reference: "STT-MY-ORDER",
    items: 10,
    status: "Shipping",
    workflow: {
      receiver: "Shop receiver",
      phone: "09123456789",
      notes: "Private shop notes",
      paymentVerified: true,
      reserved: true,
      hqComplete: false,
      received: false,
      issue: null,
      refundRequired: false,
      instructions: "Transfer instructions",
      driverId: "driver",
      driverName: "Delivery Driver",
      handover: true,
      lines: [
        {
          productId: "black-39",
          name: "STT Shoe",
          variant: "Black · EU 39",
          quantity: 4,
          unitPrice: 45000,
        },
        {
          productId: "white-40",
          name: "STT Shoe",
          variant: "White · EU 40",
          quantity: 6,
          unitPrice: 45000,
        },
      ],
      evidence: [
        {
          id: "proof",
          version: 1,
          amount: 455000,
          verifiedAmount: 455000,
          reference: "BANK-001",
          status: "approved",
          reason: null,
          createdAt: "2026-10-20T08:00:00Z",
        },
      ],
      events: [
        {
          action: "handover",
          at: "2026-10-21T08:00:00Z",
          actor: "Delivery Driver",
          reason: "",
        },
      ],
    },
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function table() {
  await act(async () =>
    root.render(<SmeOrdersTable orders={[order]} openOrder={openOrder} />),
  );
}
async function workflow(role: Role) {
  await act(async () =>
    root.render(
      <OrderWorkflow
        order={order}
        viewer={{ id: role, name: role, role }}
        accounts={[]}
        branches={[]}
        updated={vi.fn()}
        refresh={vi.fn()}
        demo
      />,
    ),
  );
}

it("uses the requested columns and keeps item inspection separate from opening order status", async () => {
  await table();
  expect(
    [...host.querySelectorAll("thead th")].map((cell) => cell.textContent),
  ).toEqual([
    "Order ID",
    "Order items",
    "Order value",
    "Order status",
    "Payment status",
    "Placed on",
    "Received on",
  ]);
  expect(host.textContent).not.toContain("My private shop");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="View 10 ordered"]',
      )!
      .click(),
  );
  expect(openOrder).not.toHaveBeenCalled();
  const dialog = host.querySelector("dialog")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  for (const text of [
    "STT Shoe",
    "Black · EU 39",
    "White · EU 40",
    "4 pairs",
    "6 pairs",
    "10 pairs",
  ])
    expect(dialog.textContent).toContain(text);
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(host.querySelector("dialog")).toBeNull();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="View order STT-MY-ORDER"]',
      )!
      .click(),
  );
  expect(openOrder).toHaveBeenCalledWith(order);
});

it("shows Not yet until SME receipt, then uses the actual receipt event in Yangon time", async () => {
  order.workflow!.hqComplete = true;
  await table();
  expect(host.textContent).toContain("Not yet");
  order.workflow!.received = true;
  order.workflow!.events.push({
    action: "receive",
    at: "2026-10-21T08:45:00Z",
    actor: "Shop receiver",
    reason: "",
  });
  await table();
  const received = host.querySelector('time[datetime="2026-10-21T08:45:00Z"]');
  expect(received?.textContent).toContain("21 Oct 2026");
  expect(received?.textContent).toContain("15:15");
  expect(host.textContent).not.toContain("Not yet");
});

it("uses HQ verification for payment status and the latest proof for pending or rejected payments", async () => {
  await table();
  expect(host.querySelector(".sme-payment-status")?.textContent).toBe(
    "Verified",
  );
  order.workflow!.paymentVerified = false;
  order.workflow!.evidence.push({
    ...order.workflow!.evidence[0],
    id: "new",
    version: 2,
    status: "pending",
  });
  await table();
  expect(host.querySelector(".sme-payment-status")?.textContent).toBe(
    "Awaiting verification",
  );
  order.workflow!.evidence[1].status = "rejected";
  await table();
  expect(host.querySelector(".sme-payment-status")?.textContent).toBe(
    "Rejected",
  );
});

it("hides the SME’s shop details and activity while retaining their delivery and receipt controls", async () => {
  await workflow("sme");
  for (const text of [
    "My private shop",
    "My shop address",
    "Shop receiver",
    "Private shop notes",
    "Order activity",
    "Payment evidence",
    "View private proof",
  ])
    expect(host.textContent).not.toContain(text);
  expect(host.textContent).toContain("Order status");
  expect(host.textContent).toContain("Delivery Driver");
  expect(host.textContent).toContain("Confirm full receipt");
});

it("retains payment evidence before verification and keeps HQ stock recovery after verification", async () => {
  order.workflow!.paymentVerified = false;
  order.status = "Awaiting verification";
  await workflow("sme");
  expect(host.textContent).toContain("Payment evidence");
  expect(host.textContent).toContain("Submit payment evidence");
  order.workflow!.paymentVerified = true;
  order.workflow!.reserved = false;
  await workflow("hq");
  expect(host.textContent).not.toContain("Payment evidence");
  expect(host.textContent).toContain("Retry stock reservation");
  expect(host.textContent).toContain("My private shop");
  expect(host.textContent).toContain("Order activity");
});

function ReceiptDialog() {
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  return (
    <>
      {open && (
        <div role="dialog">
          <OrderWorkflow
            order={order}
            viewer={{ id: "sme", name: "SME", role: "sme" }}
            accounts={[]}
            branches={[]}
            updated={async () => {}}
            refresh={vi.fn()}
            demo
            onReceiptConfirmed={(next) => {
              setOpen(false);
              setMessage(next);
            }}
          />
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}

async function confirmReceipt() {
  await act(async () => root.render(<ReceiptDialog />));
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  await act(async () => checkbox.click());
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.includes("Confirm full receipt"),
  )!;
  await act(async () => button.click());
}

it.each([false, true])(
  "closes the receipt dialog and reports success only after confirmation (HQ complete: %s)",
  async (hqComplete) => {
    let resolve!: (value: unknown) => void;
    action.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await confirmReceipt();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(action).toHaveBeenCalledWith(
      "receive",
      { orderId: order.id, fullReceipt: true },
      expect.any(String),
      {},
    );
    const received = {
      ...order,
      status: hqComplete ? "Done" : "Shipping",
      workflow: { ...order.workflow!, received: true, hqComplete },
    };
    await act(async () =>
      resolve({
        data: { ...demoData, selectedOrder: received },
        result: { message: "Receipt recorded" },
      }),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const success = host.querySelector('[role="status"]')?.textContent;
    expect(success).toContain(`Full receipt confirmed for ${order.reference}`);
    expect(success).toContain(
      hqComplete ? "Your order is complete." : "Awaiting HQ completion.",
    );
  },
);

it("keeps the receipt dialog open with an error when confirmation fails", async () => {
  action.mockResolvedValue({
    error: "Resolve the delivery issue before confirming receipt.",
  });
  await confirmReceipt();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Resolve the delivery issue",
  );
  expect(host.querySelector('[role="status"]')).toBeNull();
});
