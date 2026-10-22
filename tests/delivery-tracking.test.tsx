// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeliveryTracking } from "../src/components/delivery-tracking";
import type { DeliveryTracking as Snapshot } from "../src/lib/tracking";

const transport = vi.hoisted(() => ({
  read: vi.fn(),
  subscribe: vi.fn(),
  begin: vi.fn(),
  pause: vi.fn(),
}));
vi.mock("../src/lib/tracking-client", () => ({
  readTracking: transport.read,
  subscribeTracking: transport.subscribe,
  TrackingRequestError: class extends Error {},
}));
vi.mock("../src/components/driver-tracking-provider", () => ({
  useDriverTracking: () => ({
    trip: null,
    paused: false,
    begin: transport.begin,
    pause: transport.pause,
  }),
}));
vi.mock("../src/components/location-map", () => ({
  LocationMap: (props: any) => (
    <div
      data-testid="map"
      data-color={props.pinColor}
      data-pin={JSON.stringify(props.pin)}
      data-markers={JSON.stringify(props.markers)}
    />
  ),
}));
let host: HTMLDivElement, root: Root, client: QueryClient, snapshot: Snapshot;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  snapshot = {
    orderId: "order",
    reference: "STT-trip",
    status: "Shipping",
    attemptId: "attempt",
    driverId: "driver",
    pickedUpAt: null,
    canPublish: false,
    state: "awaiting_pickup",
    source: { name: "HQ", pin: null },
    destination: { latitude: 16.8, longitude: 96.1 },
    point: null,
  };
  transport.read.mockImplementation(async () => snapshot);
  transport.subscribe.mockImplementation(
    (_order, _demo, _changed, connection) => {
      connection(true);
      return () => {};
    },
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
async function render(role: "driver" | "hq" = "driver") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DeliveryTracking
          orderId="order"
          viewer={{ id: "driver", name: "Driver", role }}
          demo
          refresh={async () => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector(".tracking-status")).not.toBeNull();
  });
}
it("explains the missing driver pin before pickup and lets the driver hide/show the map without starting or stopping tracking", async () => {
  await render();
  expect(host.textContent).toContain(
    "Confirm pickup & start delivery and allow GPS access",
  );
  expect(host.querySelector(".tracking-legend")?.textContent).toBe(
    "Green: destination",
  );
  expect(
    host.querySelector('[data-testid="map"]')?.getAttribute("data-color"),
  ).toBe("#17674f");
  const details = host.querySelector("details")!;
  expect(details.open).toBe(true);
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(false);
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  expect(transport.subscribe).toHaveBeenCalledTimes(1);
  expect(transport.begin).not.toHaveBeenCalled();
  expect(transport.pause).not.toHaveBeenCalled();
});
it("renders the actual received driver fix in blue with destination and source markers", async () => {
  snapshot.pickedUpAt = new Date().toISOString();
  snapshot.canPublish = true;
  snapshot.state = "sharing";
  snapshot.source.pin = { latitude: 16.9, longitude: 96.2 };
  snapshot.point = {
    latitude: 16.85,
    longitude: 96.15,
    accuracy: 10,
    capturedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };
  await render();
  expect(host.textContent).toContain("Live driver location");
  const map = host.querySelector('[data-testid="map"]')!;
  expect(map.getAttribute("data-color")).toBe("#2868b2");
  expect(JSON.parse(map.getAttribute("data-pin")!)).toEqual(snapshot.point);
  expect(
    JSON.parse(map.getAttribute("data-markers")!).map((m: any) => m.id),
  ).toEqual(["source", "destination"]);
  expect(host.querySelector(".tracking-legend")?.textContent).toContain(
    "Blue: driver",
  );
});
it("explains missing GPS after pickup and labels stale fixes as last known", async () => {
  snapshot.pickedUpAt = new Date().toISOString();
  snapshot.canPublish = true;
  snapshot.state = "unavailable";
  await render();
  expect(host.textContent).toContain(
    "No driver GPS position has been received yet",
  );
  expect(host.querySelector(".tracking-legend")?.textContent).not.toContain(
    "Blue:",
  );
  snapshot = {
    ...snapshot,
    state: "sharing",
    point: {
      latitude: 16.85,
      longitude: 96.15,
      accuracy: 10,
      capturedAt: new Date(Date.now() - 120000).toISOString(),
      receivedAt: new Date().toISOString(),
    },
  };
  await act(async () => {
    await client.invalidateQueries();
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("driver’s last known position");
  });
});
it("uses grey for a source-only map and keeps the existing HQ section", async () => {
  snapshot.destination = null;
  snapshot.source.pin = { latitude: 16.9, longitude: 96.2 };
  await render("hq");
  expect(host.querySelector("details")).toBeNull();
  expect(
    host.querySelector('[data-testid="map"]')?.getAttribute("data-color"),
  ).toBe("#66756e");
  expect(host.querySelector(".tracking-legend")?.textContent).toBe(
    "Grey: dispatch source",
  );
});
