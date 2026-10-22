// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DriverGroupPickup } from "../src/components/driver-group-pickup";
import type { DriverDeliveryGroup } from "../src/lib/delivery-groups";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), fetch: vi.fn() }));
vi.mock("../src/components/driver-tracking-provider", () => ({
  useDriverTracking: () => ({ begin: mocks.begin }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
let root: Root,
  host: HTMLDivElement,
  client: QueryClient,
  groups: DriverDeliveryGroup[],
  fail: boolean;
const posts: any[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.begin.mockReset();
  posts.length = 0;
  fail = false;
  groups = [
    {
      id: "run",
      sourceName: "HQ",
      acceptedAt: null,
      stops: [1, 2, 3].map((i) => ({
        orderId: `order-${i}`,
        attemptId: `attempt-${i}`,
        position: i,
        reference: `STT-${i}`,
        business: `Shop ${i}`,
        pairs: 2,
        status: i === 3 ? "Preparing" : "Shipping",
        pickedUpAt: null,
        active: true,
        canPickup: i !== 3,
        canDeliver: false,
      })),
    },
  ];
  mocks.fetch.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push(body);
      if (fail)
        return Response.json(
          { error: "Connection interrupted. Retry." },
          { status: 503 },
        );
      if (body.action === "accept") {
        groups = [{ ...groups[0], acceptedAt: "2026-10-22T12:00:00Z" }];
        return Response.json({
          data: {
            message: "Group accepted. Location sharing has not started.",
          },
        });
      }
      const first = groups[0].stops.find((s) =>
        body.orderIds.includes(s.orderId),
      )!;
      groups = [
        {
          ...groups[0],
          stops: groups[0].stops.map((s) =>
            body.orderIds.includes(s.orderId)
              ? {
                  ...s,
                  pickedUpAt: "2026-10-22T12:01:00Z",
                  canPickup: false,
                  canDeliver: true,
                }
              : s,
          ),
        },
      ];
      return Response.json({
        data: {
          message: "Pickup confirmed.",
          publisher: {
            orderId: first.orderId,
            attemptId: first.attemptId,
            reference: first.reference,
          },
        },
      });
    }
    return Response.json({ data: groups });
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function render(orderId?: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DriverGroupPickup
          viewer={{ id: "driver", role: "driver", name: "Driver" }}
          demo
          refresh={async () => {}}
          orderId={orderId}
          fallback={<button>Single pickup</button>}
        />
      </QueryClientProvider>,
    ),
  );
  await flush();
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}
async function check(i: number) {
  await act(async () =>
    host
      .querySelector<HTMLInputElement>(`[aria-label="Collected STT-${i}"]`)!
      .click(),
  );
}
it("accepts without GPS, then starts one publisher only for explicitly checked parcels", async () => {
  await render();
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  await click("Accept delivery group");
  expect(posts[0].action).toBe("accept");
  expect(posts[0].orderIds).toEqual([]);
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(button("Confirm pickup & start route").disabled).toBe(true);
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Collected STT-3"]')!
      .disabled,
  ).toBe(true);
  await check(2);
  await click("Confirm pickup & start route");
  expect(posts[1].orderIds).toEqual(["order-2"]);
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.begin).toHaveBeenCalledWith({
    orderId: "order-2",
    attemptId: "attempt-2",
    reference: "STT-2",
    viewerId: "driver",
    demo: true,
  });
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/driver/deliveries/order-2?from=deliveries",
  );
});
it("keeps checked parcels and reuses the retry key after a failed pickup without starting GPS", async () => {
  groups[0].acceptedAt = "2026-10-22T12:00:00Z";
  await render();
  await check(1);
  fail = true;
  await click("Confirm pickup & start route");
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Connection interrupted");
  expect(host.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  fail = false;
  await click("Confirm pickup & start route");
  expect(posts[1].key).toBe(posts[0].key);
  expect(mocks.begin).toHaveBeenCalledTimes(1);
});
it("keeps the single-parcel pickup for orders outside a group", async () => {
  await render("single");
  expect(button("Single pickup")).toBeTruthy();
  expect(host.textContent).not.toContain("Accept delivery group");
});
