// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SmeCheckout } from "../src/components/sme-checkout";
import { demoData } from "../src/lib/demo-data";
import { demoPaymentInstructions } from "../src/lib/payment-instructions";
import type { Order, WorkspaceData } from "../src/lib/domain";

const action = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: action }));
vi.mock("next/image", () => ({
  default: ({ sizes: _sizes, ...props }: any) => <img {...props} />,
}));
vi.mock("../src/components/location-picker", () => ({
  LocationPicker: ({ initialPin }: { initialPin?: unknown }) => (
    <span data-initial-pin={JSON.stringify(initialPin ?? null)}>
      Optional delivery pin
    </span>
  ),
}));
let host: HTMLDivElement, root: Root, data: WorkspaceData;
const updated = vi.fn(async () => {}),
  viewOrder = vi.fn();
const order = {
  id: "new-order",
  reference: "OPL-NEW-ORDER",
  business: "Mya Thida",
  status: "Draft",
  items: 2,
  merchandise: 90000,
  shipping: 5000,
  workflow: { instructions: "Demo only", evidence: [], lines: [] },
} as unknown as Order;
async function click(text: string, container: ParentNode = host) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent?.includes(text));
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function mount() {
  await act(async () =>
    root.render(
      <SmeCheckout
        data={data}
        viewer={{
          id: "sme",
          name: "Mya Thida",
          role: "sme",
          authenticated: true,
        }}
        search=""
        query={{}}
        demo
        updated={updated}
        viewOrder={viewOrder}
      />,
    ),
  );
}
async function shopToReview() {
  await click("Add to cart", host.querySelectorAll(".catalog-product-card")[0]);
  await click("View cart");
  await click("Confirm cart & order");
  const form = host.querySelector("form")!;
  (form.elements.namedItem("receiver") as HTMLInputElement).value =
    "Demo Receiver";
  (form.elements.namedItem("address") as HTMLInputElement).value =
    "42 Test Street, Yangon";
  const PhoneFormData = window.FormData;
  vi.stubGlobal(
    "FormData",
    class extends PhoneFormData {
      constructor(element?: HTMLFormElement) {
        super(element);
        if (element?.classList.contains("checkout-shop-form")) {
          this.set("phone", "09123456789");
          this.set("phoneCountry", "MM");
        }
      }
    },
  );
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  data = {
    ...demoData,
    products: demoData.products.map((p) => ({ ...p, stock: 100 })),
    settings: {
      shipping: 5000,
      instructions: demoPaymentInstructions,
      area: "Yangon",
    },
  };
  action.mockReset();
  updated.mockClear();
  viewOrder.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("shows the imported longyi styles and reviews a selected style before ordering", async () => {
  await mount();
  expect(host.querySelectorAll(".product-card")).toHaveLength(30);
  const card = host.querySelector(".catalog-product-card")!;
  expect(card.textContent).toContain("Premium Fine Fabric Longyi");
  expect(card.textContent).toContain("Style 1.2");
  await click("Add to cart", card);
  await click("View cart");
  expect(
    host.querySelector(".checkout-cart-item img")?.getAttribute("alt"),
  ).toContain("Premium Fine Fabric Longyi");
  expect(
    host.querySelector(".checkout-cart-description")?.textContent,
  ).toContain("Style 1.2");
  expect(action).not.toHaveBeenCalled();
  await click("Remove");
  expect(host.textContent).toContain("Your cart is empty");
});
it("prefills order details from the SME's saved account location", async () => {
  data.profile = {
    phone: "+959123456789",
    address: "12 Hlaing Road, Yangon",
    pin: { latitude: 16.84, longitude: 96.17 },
  };
  await mount();
  await click("Add to cart", host.querySelectorAll(".catalog-product-card")[0]);
  await click("View cart");
  await click("Confirm cart & order");
  expect(
    (host.querySelector('[name="address"]') as HTMLTextAreaElement).value,
  ).toBe("12 Hlaing Road, Yangon");
  expect(
    (host.querySelector('[name="receiver"]') as HTMLInputElement).value,
  ).toBe("Mya Thida");
  expect(host.querySelector("[data-initial-pin]")?.getAttribute("data-initial-pin")).toBe(
    JSON.stringify({ latitude: 16.84, longitude: 96.17 }),
  );
});
it("preserves the retry key when order creation is interrupted and does not finish before evidence", async () => {
  await mount();
  await shopToReview();
  expect(host.querySelector("h2[tabindex]")?.textContent).toBe(
    "Review your order",
  );
  action.mockRejectedValueOnce(new Error("Network"));
  await click("Confirm order & continue");
  expect(host.textContent).toContain("Retry without changing");
  action.mockResolvedValueOnce({
    result: { orderId: order.id },
    data: { ...data, selectedOrder: order },
  });
  await click("Confirm order & continue");
  expect(action.mock.calls[0][2]).toBe(action.mock.calls[1][2]);
  expect(action.mock.calls[1][1].phone).toBe("+959123456789");
  expect(action.mock.calls[1][1].notes).toContain("Shop: Mya Thida");
  expect(host.textContent).toContain("Upload transaction evidence");
  expect(host.textContent).toContain("Where to transfer");
  expect(host.textContent).toContain("DEMO-KPAY-001");
  expect(host.textContent).toContain("DEMO-WAVE-002");
  expect(host.textContent).not.toContain("Your order is with HQ");
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        ...data,
        selectedOrder: {
          ...order,
          status: "Awaiting verification",
          workflow: { ...order.workflow, evidence: [{ id: "proof" }] },
        },
      },
    }),
  }));
  vi.stubGlobal("fetch", fetch);
  const form = host.querySelector(".checkout-evidence-form") as HTMLFormElement;
  const NativeFormData = window.FormData;
  vi.stubGlobal(
    "FormData",
    class extends NativeFormData {
      constructor(element?: HTMLFormElement) {
        super(element);
        this.set(
          "file",
          new File(["demo"], "receipt.png", { type: "image/png" }),
        );
        this.set("reference", "DEMO-REFERENCE");
        this.set("amount", "95000");
      }
    },
  );
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Your order is with HQ");
  expect(host.textContent).toContain("Awaiting verification");
  await click("View order");
  expect(viewOrder).toHaveBeenCalledWith(
    expect.objectContaining({ id: order.id, status: "Awaiting verification" }),
  );
});
