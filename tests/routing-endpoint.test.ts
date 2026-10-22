import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  tracking: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../src/lib/workflow/server", () => ({
  workflowActor: mocks.actor,
  WorkflowError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/lib/workflow/tracking", () => ({
  deliveryTracking: mocks.tracking,
}));
const id = "10000000-0000-4000-8000-000000000001";
const now = Date.now();
const data = {
  orderId: id,
  reference: "OPL",
  status: "Shipping",
  attemptId: "attempt",
  driverId: "driver",
  pickedUpAt: new Date(now).toISOString(),
  canPublish: true,
  state: "sharing",
  source: { name: "HQ", pin: { latitude: 16.8, longitude: 96.1 } },
  destination: { latitude: 16.81, longitude: 96.12 },
  point: {
    latitude: 16.8,
    longitude: 96.1,
    accuracy: 10,
    capturedAt: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
  },
};
const provider = {
  code: "Ok",
  routes: [
    {
      distance: 3000,
      duration: 400,
      geometry: {
        type: "LineString",
        coordinates: [
          [96.1, 16.8],
          [96.11, 16.8],
          [96.12, 16.81],
        ],
      },
      legs: [
        {
          steps: [
            {
              distance: 3000,
              duration: 400,
              maneuver: { instruction: "Head east" },
            },
          ],
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-routing");
  mocks.actor.mockResolvedValue({
    id: "driver",
    role: "driver",
    name: "Driver",
  });
  mocks.tracking.mockResolvedValue(structuredClone(data));
  mocks.fetch.mockImplementation(async () => Response.json(provider));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function handler() {
  return (await import("../src/app/api/orders/[id]/route/route")).GET;
}
const request = () =>
  new Request(`http://localhost:3100/api/orders/${id}/route`);
const context = { params: Promise.resolve({ id }) };
it("uses only the authorized stop prefix and never reuses a full-route cache for a customer", async () => {
  const get = await handler();
  const first = { position: 1, own: true, pin: data.destination };
  const later = {
    position: 2,
    own: false,
    pin: { latitude: 16.9, longitude: 96.2 },
  };
  mocks.actor.mockResolvedValue({ id: "hq", role: "hq" });
  mocks.tracking.mockResolvedValue({ ...data, run: { stops: [first, later] } });
  const full = await (await get(request(), context)).json();
  expect(full.data.route.destination).toEqual(later.pin);
  expect(String(mocks.fetch.mock.calls[0][0])).toContain(
    "96.1,16.8;96.12,16.81;96.2,16.9",
  );
  mocks.actor.mockResolvedValue({ id: "sme", role: "sme" });
  mocks.tracking.mockResolvedValue({ ...data, run: { stops: [first] } });
  const own = await (await get(request(), context)).json();
  expect(own.data.route.destination).toEqual(first.pin);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(String(mocks.fetch.mock.calls[1][0])).not.toContain("96.2,16.9");
});

it("uses only authorized stored coordinates and rechecks access before cache hits", async () => {
  const get = await handler();
  const result = await get(new Request(`${request().url}?origin=0,0`), context);
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await result.json()).data.route.geometry.coordinates).toHaveLength(3);
  expect(String(mocks.fetch.mock.calls[0][0])).toContain(
    "96.1,16.8;96.12,16.81",
  );
  await get(request(), context);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.tracking).toHaveBeenCalledTimes(2);
  const { WorkflowError } = await import("../src/lib/workflow/server");
  mocks.tracking.mockRejectedValue(new WorkflowError("Not your delivery", 403));
  expect((await get(request(), context)).status).toBe(403);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("blocks unsigned accounts before calling tracking or Mapbox", async () => {
  const get = await handler();
  const { WorkflowError } = await import("../src/lib/workflow/server");
  mocks.actor.mockRejectedValue(new WorkflowError("Sign in", 401));
  expect((await get(request(), context)).status).toBe(401);
  expect(mocks.tracking).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("does not fabricate a route with missing pins, GPS or a stopped delivery", async () => {
  const get = await handler();
  for (const changes of [
    { destination: null },
    { point: null },
    { state: "stopped" },
    { pickedUpAt: null, source: { name: "HQ", pin: null } },
  ]) {
    mocks.tracking.mockResolvedValue({ ...data, ...changes });
    const result = await (await get(request(), context)).json();
    expect(result.data.route).toBeNull();
    expect(result.data.reason).toBeTruthy();
  }
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("supports a planned dispatch route and separates a replacement attempt cache", async () => {
  const get = await handler();
  mocks.tracking.mockResolvedValue({ ...data, pickedUpAt: null, point: null });
  let result = await (await get(request(), context)).json();
  expect(result.data.route.mode).toBe("planned");
  mocks.tracking.mockResolvedValue({ ...data, attemptId: "replacement" });
  result = await (await get(request(), context)).json();
  expect(result.data.route.attemptId).toBe("replacement");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it("deduplicates concurrent requests and hides provider details on failure", async () => {
  const get = await handler();
  let release!: (value: Response) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const first = get(request(), context),
    second = get(request(), context);
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  release(Response.json(provider));
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
});
it("backs off provider errors without exposing tokens or a fake straight route", async () => {
  const get = await handler();
  mocks.fetch.mockResolvedValue(
    Response.json({ message: "pk.test-routing" }, { status: 403 }),
  );
  const response = await get(request(), context);
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).not.toContain("pk.test-routing");
  expect(body).toContain("routing access was refused");
  await get(request(), context);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("denies branch accounts before tracking and maps local permission failures to 403", async () => {
  const get = await handler();
  mocks.actor.mockResolvedValue({
    id: "branch",
    role: "branch",
    name: "Branch",
  });
  expect((await get(request(), context)).status).toBe(403);
  expect(mocks.tracking).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue({
    id: "other",
    role: "sme",
    name: "Other SME",
  });
  mocks.tracking.mockRejectedValue(new Error("private SQL details"));
  const result = await get(request(), context);
  expect(result.status).toBe(403);
  expect(await result.text()).not.toContain("private SQL details");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
