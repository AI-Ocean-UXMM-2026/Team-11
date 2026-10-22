import "server-only";
import { z } from "zod";
import { publicMapboxToken, mapboxCoordinates } from "../maps";
import {
  routeOrigin,
  shouldRefreshRoute,
  ROUTE_COOLDOWN_MS,
  type RoadRoute,
  type RouteResponse,
} from "../routing";
import type { DeliveryTracking } from "../tracking";
import type { Viewer } from "../domain";
import { deliveryTracking } from "./tracking";
import { WorkflowError } from "./server";

const coordinate = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const providerResponse = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(coordinate).min(2).max(50000),
        }),
        legs: z
          .array(
            z.object({
              steps: z
                .array(
                  z.object({
                    distance: z.number().finite().nonnegative(),
                    duration: z.number().finite().nonnegative(),
                    maneuver: z.object({ instruction: z.string().max(1000) }),
                  }),
                )
                .max(2000),
            }),
          )
          .max(25),
      }),
    )
    .max(5),
});
type Entry = {
  orderId: string;
  attemptId: string | null;
  route?: RoadRoute;
  requestedAt: number;
  pending?: Promise<RouteResponse>;
  error?: WorkflowError;
};
// Bounded, short-lived, process-local cache. Authorization runs before every lookup.
const routes = new Map<string, Entry>();
const TTL = 5 * 60_000;
export async function calculateRoadRoute(
  data: DeliveryTracking,
  referer?: string,
): Promise<RouteResponse> {
  const now = Date.now();
  for (const [id, entry] of routes)
    if (
      (!entry.pending && now - entry.requestedAt > TTL) ||
      (entry.orderId === data.orderId &&
        (data.state === "stopped" || entry.attemptId !== data.attemptId))
    )
      routes.delete(id);
  const origin = routeOrigin(data);
  if (data.state === "stopped")
    return { route: null, reason: "Delivery ended. Live routing has stopped." };
  if (!data.destination)
    return {
      route: null,
      reason:
        "This order has no saved destination pin. Contact HQ to confirm the delivery location.",
    };
  if (!origin)
    return {
      route: null,
      reason: data.pickedUpAt
        ? "Waiting for the driver's GPS location to calculate the road route."
        : "A planned route needs a dispatch location pin. After pickup, the route can start from the driver's GPS position.",
    };
  const mode = data.pickedUpAt ? "delivery" : "planned";
  const destination = data.destination;
  const key = JSON.stringify([
    data.orderId,
    data.attemptId,
    mode,
    destination,
    mode === "planned" ? origin : null,
  ]);
  const cached = routes.get(key);
  if (cached?.pending) return cached.pending;
  if (cached?.route && !shouldRefreshRoute(cached.route, data, now))
    return { route: cached.route };
  if (cached && now - cached.requestedAt < ROUTE_COOLDOWN_MS) {
    if (cached.route) return { route: cached.route };
    if (cached.error) throw cached.error;
  }
  const token =
    process.env.MAPBOX_DIRECTIONS_TOKEN?.trim() || publicMapboxToken();
  if (!token)
    throw new WorkflowError(
      "Road routing is not configured. HQ must configure a Mapbox Directions token.",
      503,
    );
  while (routes.size >= 100) {
    const oldest = [...routes].find(([, entry]) => !entry.pending);
    if (!oldest)
      throw new WorkflowError("Routing is busy. Try again shortly.", 429);
    routes.delete(oldest[0]);
  }
  const entry: Entry = {
    orderId: data.orderId,
    attemptId: data.attemptId,
    requestedAt: now,
    route: cached?.route,
  };
  const promise = (async (): Promise<RouteResponse> => {
    try {
      const url = new URL(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${mapboxCoordinates(origin).join(",")};${mapboxCoordinates(destination).join(",")}`,
      );
      url.search = new URLSearchParams({
        access_token: token,
        geometries: "geojson",
        overview: "full",
        steps: "true",
        alternatives: "false",
        language: "en",
      }).toString();
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: referer ? { Referer: referer } : undefined,
      });
      if (!response.ok)
        throw new WorkflowError(
          response.status === 401 || response.status === 403
            ? "Mapbox routing access was refused. HQ should check the Directions token and its allowed URLs."
            : "Road routing is temporarily unavailable. Try again shortly.",
          503,
        );
      const body = providerResponse.safeParse(await response.json());
      if (!body.success || body.data.code !== "Ok" || !body.data.routes[0])
        throw new WorkflowError(
          "No drivable road route was found for these locations. Confirm the destination with HQ.",
          422,
        );
      const result = body.data.routes[0];
      const route: RoadRoute = {
        attemptId: data.attemptId,
        mode,
        origin: { latitude: origin.latitude, longitude: origin.longitude },
        destination,
        geometry: result.geometry,
        distance: result.distance,
        duration: result.duration,
        steps: result.legs.flatMap((leg) =>
          leg.steps.map((step) => ({
            distance: step.distance,
            duration: step.duration,
            instruction: step.maneuver.instruction,
          })),
        ),
        generatedAt: new Date(now).toISOString(),
        originCapturedAt:
          mode === "delivery" ? (data.point?.capturedAt ?? null) : null,
      };
      entry.route = route;
      entry.error = undefined;
      return { route };
    } catch (error) {
      entry.error =
        error instanceof WorkflowError
          ? error
          : new WorkflowError(
              "Road routing could not connect. The map and manual delivery actions are still available.",
              503,
            );
      throw entry.error;
    } finally {
      entry.pending = undefined;
    }
  })();
  entry.pending = promise;
  routes.set(key, entry);
  return promise;
}
export async function deliveryRoadRoute(
  actor: Viewer,
  orderId: string,
  referer?: string,
) {
  // The existing checked RPC verifies account status, ownership and assignment,
  // including for cache hits. Request coordinates are never accepted from clients.
  if (!["hq", "sme", "driver"].includes(actor.role))
    throw new WorkflowError("This account cannot view delivery routes.", 403);
  const tracking = await deliveryTracking(actor, orderId).catch(
    (error: unknown) => {
      if (error instanceof WorkflowError) throw error;
      throw new WorkflowError(
        "This delivery's route is unavailable to this account.",
        403,
      );
    },
  );
  return calculateRoadRoute(tracking, referer);
}
