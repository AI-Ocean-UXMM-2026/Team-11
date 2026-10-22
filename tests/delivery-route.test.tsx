// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DeliveryRoute } from "../src/components/delivery-route";
import type { DeliveryTracking } from "../src/lib/tracking";
import type { RoadRoute } from "../src/lib/routing";
vi.mock("../src/components/location-map", () => ({
  LocationMap: (p: any) => (
    <div
      data-testid="road-map"
      data-route={JSON.stringify(p.route)}
      data-remaining={JSON.stringify(p.remainingRoute)}
      data-navigation={String(p.navigation)}
      data-markers={JSON.stringify(p.markers)}
    />
  ),
}));
let root: Root,
  host: HTMLDivElement,
  client: QueryClient,
  data: DeliveryTracking,
  route: RoadRoute;
const fetchRoute = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchRoute);
  fetchRoute.mockReset();
  const date = new Date().toISOString();
  data = {
    orderId: "order",
    reference: "OPL",
    status: "Shipping",
    attemptId: "attempt",
    driverId: "driver",
    pickedUpAt: date,
    canPublish: true,
    state: "sharing",
    source: { name: "HQ", pin: { latitude: 16.8, longitude: 96.1 } },
    destination: { latitude: 16.82, longitude: 96.12 },
    point: {
      latitude: 16.8,
      longitude: 96.11,
      accuracy: 10,
      capturedAt: date,
      receivedAt: date,
    },
  };
  route = {
    attemptId: "attempt",
    mode: "delivery",
    origin: data.source.pin!,
    destination: data.destination!,
    geometry: {
      type: "LineString",
      coordinates: [
        [96.1, 16.8],
        [96.12, 16.8],
        [96.12, 16.82],
      ],
    },
    distance: 4400,
    duration: 600,
    steps: [
      { instruction: "Head east", distance: 2200, duration: 300 },
      { instruction: "Turn left", distance: 2200, duration: 300 },
    ],
    generatedAt: date,
    originCapturedAt: date,
  };
  fetchRoute.mockImplementation(async () => Response.json({ data: { route } }));
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
async function render(live = true, role: "driver" | "hq" | "sme" = "driver") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DeliveryRoute
          data={data}
          viewer={{ id: role, role, name: role }}
          demo
          live={live}
          now={Date.now()}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("shows live road distance, estimated arrival and next instruction with actual route geometry", async () => {
  await render();
  expect(host.textContent).toContain("Remaining distance");
  expect(host.textContent).toContain("Estimated arrival");
  expect(host.textContent).toContain("Turn left");
  expect(
    host
      .querySelector('[data-testid="road-map"]')
      ?.getAttribute("data-navigation"),
  ).toBe("true");
  expect(
    JSON.parse(
      host
        .querySelector('[data-testid="road-map"]')!
        .getAttribute("data-route")!,
    ),
  ).toEqual(route.geometry.coordinates);
});
it("labels stale GPS estimates and hides live arrival/follow controls for HQ and SMEs", async () => {
  await render(false, "hq");
  expect(host.textContent).toContain("not live");
  expect(host.textContent).not.toContain("Estimated arrival");
  expect(host.textContent).not.toContain("Next direction");
  expect(
    host
      .querySelector('[data-testid="road-map"]')
      ?.getAttribute("data-navigation"),
  ).toBe("false");
});
it("labels preceding customer stops anonymously and shows the customer's own numbered destination", async () => {
  data.run = {
    stops: [
      { position: 1, own: false, pin: { latitude: 16.81, longitude: 96.115 } },
      { position: 2, own: true, pin: data.destination! },
    ],
  };
  await render(true, "sme");
  expect(host.textContent).toContain("Earlier delivery stop");
  expect(host.textContent).toContain("Your delivery");
  expect(host.textContent).toContain("delivery details are private");
  const markers = JSON.parse(
    host
      .querySelector('[data-testid="road-map"]')!
      .getAttribute("data-markers")!,
  );
  expect(markers.find((marker: any) => marker.id === "stop-1")).toMatchObject({
    number: 1,
    label: "Stop 1: earlier delivery stop",
  });
  expect(markers.find((marker: any) => marker.id === "stop-2")).toMatchObject({
    number: 2,
    color: "#16834A",
  });
});
it("shows planned source routing before pickup, and does not request a route without a source or destination", async () => {
  data = { ...data, pickedUpAt: null, point: null };
  route = { ...route, mode: "planned" };
  await render(false);
  expect(host.textContent).toContain("Planned road route");
  expect(host.textContent).toContain("Head east");
  expect(host.textContent).not.toContain("Estimated arrival");
  data = { ...data, source: { name: "HQ", pin: null } };
  await render(false);
  expect(host.textContent).toContain("needs a dispatch pin");
  expect(
    host.querySelector('[data-testid="road-map"]')?.getAttribute("data-route"),
  ).toBeNull();
  expect(fetchRoute).toHaveBeenCalledTimes(1);
});
it("keeps maps/manual actions available on provider failure and clears routing on delivery stop", async () => {
  fetchRoute.mockResolvedValue(
    Response.json(
      { error: "Directions temporarily unavailable" },
      { status: 503 },
    ),
  );
  await render();
  expect(host.textContent).toContain("Directions temporarily unavailable");
  expect(host.textContent).toContain(
    "Manual delivery updates remain available",
  );
  expect(host.querySelector('[data-testid="road-map"]')).not.toBeNull();
  data = { ...data, state: "stopped", point: null };
  await render(false);
  expect(host.textContent).toContain("Live routing has stopped");
  expect(
    host.querySelector('[data-testid="road-map"]')?.getAttribute("data-route"),
  ).toBeNull();
});
it("requests a reroute only after the cooldown when fresh accurate GPS is off the saved road", async () => {
  route.generatedAt = new Date(Date.now() - 40000).toISOString();
  data = {
    ...data,
    point: { ...data.point!, latitude: 16.81, longitude: 96.105 },
  };
  await render();
  expect(fetchRoute).toHaveBeenCalledTimes(1);
  data = {
    ...data,
    point: {
      ...data.point!,
      capturedAt: new Date(Date.now() + 1).toISOString(),
    },
  };
  await render();
  expect(fetchRoute).toHaveBeenCalledTimes(1);
  const advanced = Date.now() + 31_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(advanced);
  data = {
    ...data,
    point: { ...data.point!, capturedAt: new Date(advanced).toISOString() },
  };
  await render();
  expect(fetchRoute).toHaveBeenCalledTimes(2);
  clock.mockRestore();
});
