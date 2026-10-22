// Integration check against an explicit isolated demo only. Uses synthetic GPS.
import assert from "node:assert/strict";
const base =
  process.env.SUPPLYLINK_ROUTING_SMOKE_URL || "http://127.0.0.1:3100";
const url = new URL(base);
assert.ok(
  url.hostname === "127.0.0.1" &&
    url.protocol === "http:" &&
    url.port !== "3000",
  "Use the isolated local demo, never the user's port 3000.",
);
const jars = {};
async function login(role, name, key = role) {
  const response = await fetch(`${base}/api/auth/${role}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: name, password: "SttDemo-2026!" }),
  });
  assert.equal(response.status, 200, `Sample ${role} sign in`);
  jars[key] = response.headers.get("set-cookie").split(";")[0];
}
async function get(role, path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { Cookie: jars[role] || "", Origin: base, ...options.headers },
    redirect: "manual",
  });
}
assert.ok(
  (await (await fetch(`${base}/driver/login`)).text()).includes(
    "Local demo credentials",
  ),
  "Explicit demo credentials must be visible before testing.",
);
await login("driver", "zawmin");
const snapshot = await (await get("driver", "/api/workflow")).json();
assert.equal(snapshot.demo, true, "Only an explicit demo may be changed.");
const order = snapshot.data.orders.find((o) => o.status === "Shipping");
assert.ok(order, "A seeded shipping delivery is required.");
const trackingPath = `/api/orders/${order.id}/tracking`,
  path = `/api/orders/${order.id}/route`;
const tracking = await (await get("driver", trackingPath)).json();
assert.ok(tracking.data.pickedUpAt, "Use an already-picked-up demo trip.");
const published = await get("driver", trackingPath, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    attemptId: tracking.data.attemptId,
    state: "sharing",
    point: {
      latitude: 16.835,
      longitude: 96.135,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
    },
  }),
});
assert.equal(published.status, 200, "Publish a synthetic foreground GPS point");
const response = await get("driver", path),
  body = await response.json();
assert.equal(response.status, 200, body.error);
const route = body.data.route;
assert.ok(
  route.geometry.coordinates.length > 2,
  "Mapbox must return a road route, not an invented straight line.",
);
assert.ok(route.steps.length > 0 && route.distance > 0 && route.duration > 0);
assert.equal(response.headers.get("Cache-Control"), "private, no-store");
assert.equal((await get("none", path)).status, 401);
await login("sme", "myathida");
await login("sme", "shwepyi", "otherSme");
await login("branch", "branch.hlaing");
await login("hq", "hq.admin");
assert.equal((await get("sme", path)).status, 200, "Owning SME route");
assert.equal((await get("hq", path)).status, 200, "HQ route");
assert.equal((await get("branch", path)).status, 403, "Branch route denied");
assert.equal(
  (await get("otherSme", path)).status,
  403,
  "Unrelated SME route denied",
);
assert.equal(
  (await get("driver", `/driver/deliveries/${order.id}`)).status,
  200,
);
assert.ok(
  [303, 307, 308].includes(
    (await get("sme", `/driver/deliveries/${order.id}`)).status,
  ),
  "Wrong role cannot open focused driver page",
);
console.log(
  JSON.stringify({
    passed: true,
    orderId: order.id,
    roadCoordinates: route.geometry.coordinates.length,
    directions: route.steps.length,
    metres: Math.round(route.distance),
    estimatedSeconds: Math.round(route.duration),
    checks: [
      "synthetic GPS",
      "real Mapbox road geometry",
      "HQ/SME/driver access",
      "branch/unrelated/unsigned denial",
      "focused driver page",
    ],
  }),
);
