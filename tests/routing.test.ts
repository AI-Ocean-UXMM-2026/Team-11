import { expect, it } from "vitest";
import {
  routeProgress,
  routeOrigin,
  shouldRefreshRoute,
  type RoadRoute,
} from "../src/lib/routing";
import type { DeliveryTracking } from "../src/lib/tracking";
const now = Date.now();
const route: RoadRoute = {
  attemptId: "attempt",
  mode: "delivery",
  origin: { latitude: 16.8, longitude: 96.1 },
  destination: { latitude: 16.82, longitude: 96.12 },
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
  generatedAt: new Date(now - 200000).toISOString(),
  originCapturedAt: new Date(now).toISOString(),
  steps: [
    { instruction: "Head east", distance: 2200, duration: 300 },
    { instruction: "Turn left", distance: 2200, duration: 300 },
    { instruction: "Arrive", distance: 0, duration: 0 },
  ],
};
const tracking: DeliveryTracking = {
  orderId: "order",
  reference: "STT",
  status: "Shipping",
  attemptId: "attempt",
  driverId: "driver",
  pickedUpAt: new Date(now).toISOString(),
  canPublish: true,
  state: "sharing",
  source: { name: "HQ", pin: { latitude: 16.8, longitude: 96.1 } },
  destination: route.destination,
  point: {
    latitude: 16.8,
    longitude: 96.11,
    accuracy: 10,
    capturedAt: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
  },
};
it("projects progress onto the road bends rather than a straight destination line", () => {
  const progress = routeProgress(route, { latitude: 16.8, longitude: 96.11 });
  expect(progress.completed).toBeGreaterThan(0.2);
  expect(progress.completed).toBeLessThan(0.3);
  expect(progress.offRoute).toBeLessThan(1);
  expect(progress.remainingDuration).toBeGreaterThan(400);
  expect(progress.nextInstruction).toBe("Turn left");
  expect(progress.remainingCoordinates).toEqual([
    [96.11, 16.8],
    [96.12, 16.8],
    [96.12, 16.82],
  ]);
  expect(routeProgress(route, route.destination).remainingDistance).toBe(0);
});
it("uses dispatch pins before pickup, GPS after pickup and no origin after stop", () => {
  expect(routeOrigin({ ...tracking, pickedUpAt: null })).toEqual(
    tracking.source.pin,
  );
  expect(routeOrigin(tracking)).toEqual(tracking.point);
  expect(routeOrigin({ ...tracking, point: null })).toBeNull();
  expect(routeOrigin({ ...tracking, state: "stopped" })).toBeNull();
});
it("reroutes with movement or off-route GPS, respecting cooldown, freshness and accuracy", () => {
  expect(shouldRefreshRoute(route, tracking, now)).toBe(true);
  const recent = { ...route, generatedAt: new Date(now - 40000).toISOString() };
  expect(shouldRefreshRoute(recent, tracking, now)).toBe(false);
  const off = {
    ...tracking,
    point: { ...tracking.point!, latitude: 16.81, longitude: 96.105 },
  };
  expect(shouldRefreshRoute(recent, off, now)).toBe(true);
  expect(
    shouldRefreshRoute(
      { ...recent, generatedAt: new Date(now - 10000).toISOString() },
      off,
      now,
    ),
  ).toBe(false);
  expect(
    shouldRefreshRoute(
      route,
      { ...off, point: { ...off.point, accuracy: 200 } },
      now,
    ),
  ).toBe(false);
  expect(shouldRefreshRoute(route, { ...off, state: "paused" }, now)).toBe(
    false,
  );
  expect(
    shouldRefreshRoute(
      route,
      {
        ...off,
        point: {
          ...off.point,
          capturedAt: new Date(now - 70000).toISOString(),
        },
      },
      now,
    ),
  ).toBe(false);
});
