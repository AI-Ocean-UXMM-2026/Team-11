import type { LocationPin } from "./contact";
import type { DeliveryTracking } from "./tracking";
import { locationIsFresh } from "./tracking";

export type Coordinate = [number, number];
export interface RoadRoute {
  attemptId: string | null;
  mode: "planned" | "delivery";
  origin: LocationPin;
  destination: LocationPin;
  geometry: { type: "LineString"; coordinates: Coordinate[] };
  distance: number;
  duration: number;
  steps: { instruction: string; distance: number; duration: number }[];
  generatedAt: string;
  originCapturedAt: string | null;
}
export type RouteResponse = { route: RoadRoute | null; reason?: string };
export const ROUTE_COOLDOWN_MS = 30_000;
export const ROUTE_REFRESH_MS = 180_000;

export function routeOrigin(data: DeliveryTracking): LocationPin | null {
  if (data.state === "stopped") return null;
  return data.pickedUpAt ? data.point : data.source.pin;
}
export function metresBetween(a: LocationPin, b: LocationPin) {
  const radians = Math.PI / 180;
  const lat = (a.latitude + b.latitude) * 0.5 * radians;
  return (
    Math.hypot(
      (b.longitude - a.longitude) * Math.cos(lat),
      b.latitude - a.latitude,
    ) *
    radians *
    6_371_000
  );
}

// Project onto the road geometry for display only. Never changes the recorded GPS fix.
export function routeProgress(route: RoadRoute, point: LocationPin) {
  const coordinates = route.geometry.coordinates;
  const scale = Math.cos((point.latitude * Math.PI) / 180);
  let total = 0,
    along = 0,
    nearest = Infinity,
    segment = 0,
    fraction = 0;
  let projected: Coordinate = coordinates[0];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i],
      b = coordinates[i + 1];
    const dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1];
    const px = (point.longitude - a[0]) * scale,
      py = point.latitude - a[1];
    const t = Math.max(
      0,
      Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
    );
    const pin = {
      longitude: a[0] + (b[0] - a[0]) * t,
      latitude: a[1] + (b[1] - a[1]) * t,
    };
    const distance = metresBetween(point, pin);
    const length = metresBetween(
      { longitude: a[0], latitude: a[1] },
      { longitude: b[0], latitude: b[1] },
    );
    if (distance < nearest) {
      nearest = distance;
      along = total + length * t;
      segment = i;
      fraction = t;
      projected = [pin.longitude, pin.latitude];
    }
    total += length;
  }
  const completed = total ? Math.min(1, along / total) : 0;
  const travelled = route.distance * completed;
  let stepEnd = 0;
  let next =
    route.steps.at(-1)?.instruction ?? "Continue to the delivery destination";
  let turnDistance = 0;
  for (let i = 0; i < route.steps.length; i++) {
    stepEnd += route.steps[i].distance;
    if (stepEnd > travelled + 15) {
      next = route.steps[i + 1]?.instruction ?? route.steps[i].instruction;
      turnDistance = Math.max(0, stepEnd - travelled);
      break;
    }
  }
  return {
    completed,
    offRoute: nearest,
    remainingDistance: route.distance * (1 - completed),
    remainingDuration: route.duration * (1 - completed),
    nextInstruction: next,
    turnDistance,
    remainingCoordinates: [
      projected,
      ...coordinates.slice(segment + (fraction >= 1 ? 2 : 1)),
    ] as Coordinate[],
  };
}
export function shouldRefreshRoute(
  route: RoadRoute,
  data: DeliveryTracking,
  now = Date.now(),
) {
  if (!data.point || !locationIsFresh(data, now) || data.point.accuracy > 100)
    return false;
  const age = now - Date.parse(route.generatedAt);
  if (age < ROUTE_COOLDOWN_MS) return false;
  return (
    routeProgress(route, data.point).offRoute >
      Math.max(80, data.point.accuracy * 2) ||
    (age >= ROUTE_REFRESH_MS && metresBetween(route.origin, data.point) >= 200)
  );
}
export function routeDistance(metres: number) {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)} km`
    : `${Math.max(0, Math.round(metres / 10) * 10)} m`;
}
export function routeTime(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${minutes} min`;
}
