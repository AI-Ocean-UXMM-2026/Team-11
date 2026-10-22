// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("../src/components/delivery-tracking", () => ({
  DeliveryTracking: () => (
    <section aria-label="Delivery navigation">Road map and directions</section>
  ),
}));
vi.mock("../src/lib/workspace", () => ({ loadWorkspace: mocks.load }));
vi.mock("../src/components/workspace-page", () => ({
  WorkspacePage: () => null,
}));
vi.mock("../src/components/workspace-query-provider", () => ({
  WorkspaceQueryProvider: ({ children }: { children: ReactNode }) => children,
}));
import { DriverDeliveryScreen } from "../src/components/driver-delivery-screen";
import DriverPortal from "../src/app/driver/[[...path]]/page";
import NavigationPage from "../src/app/driver/deliveries/[orderId]/page";
let host: HTMLDivElement, root: Root;
const orderId = "10000000-0000-4000-8000-000000000001";
const viewer = { id: "driver", name: "Driver", role: "driver" as const };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.load.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("renders map-only navigation and returns to the same order popup on its original page", async () => {
  for (const origin of ["overview", "deliveries"] as const) {
    await act(async () =>
      root.render(
        <DriverDeliveryScreen
          viewer={viewer}
          orderId={orderId}
          demo
          origin={origin}
        />,
      ),
    );
    expect(
      host.querySelector('[aria-label="Delivery navigation"]'),
    ).not.toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      `${origin === "overview" ? "/driver" : "/driver/deliveries"}?order=${orderId}`,
    );
    expect(host.querySelector("a")?.textContent).toContain("Back to order");
    for (const text of [
      "STT WHOLESALE",
      "Fulfilment",
      "Report delivery handover",
      "Order activity",
      "STT Everyday sneaker",
    ])
      expect(host.textContent).not.toContain(text);
  }
});
it("passes a valid return selection to the protected driver workspace and rejects malformed IDs", async () => {
  const result = await DriverPortal({
    params: Promise.resolve({ path: ["deliveries"] }),
    searchParams: Promise.resolve({ order: orderId }),
  });
  expect(result.props.restoreOrderId).toBe(orderId);
  expect(result.props.requiredRole).toBe("driver");
  await expect(
    DriverPortal({
      params: Promise.resolve({ path: ["deliveries"] }),
      searchParams: Promise.resolve({ order: "not-an-order" }),
    }),
  ).rejects.toThrow("NOT_FOUND");
});
it("checks assignment for the focused route and passes no order records into the navigation screen", async () => {
  mocks.load.mockResolvedValue({
    viewer,
    demo: true,
    data: { selectedOrder: { id: orderId, business: "Private shop" } },
  });
  const result = await NavigationPage({
    params: Promise.resolve({ orderId }),
    searchParams: Promise.resolve({ from: "overview" }),
  });
  expect(mocks.load).toHaveBeenCalledWith(undefined, "driver", { orderId });
  expect(result.props.children.props).toEqual({
    viewer,
    demo: true,
    orderId,
    origin: "overview",
  });
  mocks.load.mockResolvedValue({
    viewer,
    demo: true,
    data: { selectedOrder: null },
  });
  await expect(
    NavigationPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow("NOT_FOUND");
});
