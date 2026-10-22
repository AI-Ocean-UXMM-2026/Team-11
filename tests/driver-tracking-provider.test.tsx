// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  DriverTrackingProvider,
  useDriverTracking,
} from "../src/components/driver-tracking-provider";
import type { DeliveryTracking } from "../src/lib/tracking";

const transport = vi.hoisted(() => ({
  path: "/driver/deliveries",
  changed: () => {},
  read: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => transport.path }));
vi.mock("../src/lib/tracking-client", () => ({
  readTracking: transport.read,
  sendLocation: transport.send,
  subscribeTracking: transport.subscribe,
  TrackingRequestError: class extends Error {},
}));
const watch = vi.fn(),
  clear = vi.fn();
let success: PositionCallback, failure: PositionErrorCallback;
let root: Root, host: HTMLDivElement;
let snapshot: DeliveryTracking;
function Controls() {
  const tracker = useDriverTracking();
  return (
    <>
      <button
        onClick={() =>
          tracker.begin({
            orderId: "order",
            attemptId: "attempt",
            viewerId: "driver",
            demo: false,
            reference: "OPL-trip",
          })
        }
      >
        Pickup confirmed
      </button>
      <button onClick={tracker.pause}>Pause</button>
      <button onClick={tracker.resume}>Resume</button>
      <p>{tracker.message}</p>
      <span>{tracker.trip?.orderId}</span>
    </>
  );
}
const render = () =>
  act(async () =>
    root.render(
      <DriverTrackingProvider>
        <Controls />
      </DriverTrackingProvider>,
    ),
  );
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === text)!
      .click(),
  );
}
beforeEach(() => {
  transport.path = "/driver/deliveries";
  snapshot = {
    orderId: "order",
    reference: "OPL-trip",
    status: "Shipping",
    attemptId: "attempt",
    driverId: "driver",
    pickedUpAt: new Date().toISOString(),
    canPublish: true,
    state: "unavailable",
    source: { name: "HQ", pin: null },
    destination: null,
    point: null,
  };
  transport.read.mockImplementation(async () => snapshot);
  transport.send.mockImplementation(async (_id, update) => ({
    ...snapshot,
    state: update.state,
    point: update.point ?? snapshot.point,
  }));
  transport.subscribe.mockImplementation((_id, _demo, changed) => {
    transport.changed = changed;
    return () => {};
  });
  watch.mockImplementation(
    (ok: PositionCallback, error: PositionErrorCallback) => {
      success = ok;
      failure = error;
      return watch.mock.calls.length;
    },
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: watch, clearWatch: clear },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator, "geolocation");
  Reflect.deleteProperty(document, "visibilityState");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("starts only after pickup, keeps sharing across portal navigation and throttles fresh GPS writes", async () => {
  await render();
  expect(watch).not.toHaveBeenCalled();
  await click("Pickup confirmed");
  expect(watch).toHaveBeenCalledTimes(1);
  const fix = {
    timestamp: Date.now(),
    coords: { latitude: 16.84, longitude: 96.17, accuracy: 9 },
  } as GeolocationPosition;
  await act(async () => success(fix));
  expect(
    transport.send.mock.calls.filter((args) => args[1].state === "sharing"),
  ).toHaveLength(1);
  await act(async () => success(fix));
  expect(
    transport.send.mock.calls.filter((args) => args[1].state === "sharing"),
  ).toHaveLength(1);
  transport.path = "/driver";
  await render();
  expect(watch).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Live location is being shared");
  await click("Pause");
  expect(clear).toHaveBeenCalled();
  await click("Resume");
  expect(watch).toHaveBeenCalledTimes(2);
});

it("pauses in the background and keeps manual delivery available after GPS denial", async () => {
  await render();
  await click("Pickup confirmed");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(clear).toHaveBeenCalled();
  expect(host.textContent).toContain("Return to this page");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(watch).toHaveBeenCalledTimes(2);
  await act(async () => failure({ code: 1 } as GeolocationPositionError));
  expect(host.textContent).toContain("permission denied");
  expect(host.textContent).toContain("order");
  await click("Resume");
  expect(watch).toHaveBeenCalledTimes(3);
});

it("clears the GPS watch when handover ends the active attempt or the driver signs out", async () => {
  await render();
  await click("Pickup confirmed");
  snapshot = { ...snapshot, canPublish: false, state: "stopped" };
  await act(async () => transport.changed());
  expect(clear).toHaveBeenCalled();
  expect(host.querySelector("span")?.textContent).toBe("");
  snapshot = { ...snapshot, canPublish: true, state: "unavailable" };
  await click("Pickup confirmed");
  const count = clear.mock.calls.length;
  transport.path = "/driver/login";
  await render();
  expect(clear.mock.calls.length).toBeGreaterThan(count);
  expect(host.querySelector("span")?.textContent).toBe("");
});

it("continues GPS for the next picked-up group stop after the current handover", async () => {
  await render();
  await click("Pickup confirmed");
  const next = {
    orderId: "next-order",
    attemptId: "next-attempt",
    reference: "OPL-next",
  };
  const active = { ...snapshot, ...next };
  snapshot = {
    ...snapshot,
    state: "stopped",
    canPublish: false,
    run: { stops: [], publisher: next },
  };
  transport.read.mockImplementation(async (id) =>
    id === "next-order" ? active : snapshot,
  );
  transport.send.mockImplementation(async (id, update) => ({
    ...(id === "next-order" ? active : snapshot),
    state: update.state,
  }));
  await act(async () => transport.changed());
  expect(host.querySelector("span")?.textContent).toBe("next-order");
  expect(watch.mock.calls.length).toBeGreaterThan(1);
  await act(async () =>
    success({
      timestamp: Date.now(),
      coords: { latitude: 16.84, longitude: 96.17, accuracy: 9 },
    } as GeolocationPosition),
  );
  expect(
    transport.send.mock.calls.some(
      ([id, update]) => id === "next-order" && update.state === "sharing",
    ),
  ).toBe(true);
});
