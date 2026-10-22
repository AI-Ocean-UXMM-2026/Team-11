"use client";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigation, RefreshCw, Route, Clock3 } from "lucide-react";
import type { Viewer } from "@/lib/domain";
import type { DeliveryTracking } from "@/lib/tracking";
import {
  routeOrigin,
  routeProgress,
  routeDistance,
  routeTime,
  shouldRefreshRoute,
  ROUTE_COOLDOWN_MS,
  type RouteResponse,
} from "@/lib/routing";
import { LocationMap } from "./location-map";

export function DeliveryRoute({
  data,
  viewer,
  demo,
  live,
  now,
  focused = false,
}: {
  data: DeliveryTracking;
  viewer: Viewer;
  demo: boolean;
  live: boolean;
  now: number;
  focused?: boolean;
}) {
  const client = useQueryClient();
  const requested = useRef(0);
  const origin = routeOrigin(data);
  const enabled = !!origin && !!data.destination && data.state !== "stopped";
  const mode = data.pickedUpAt ? "delivery" : "planned";
  const key = [
    "delivery-route",
    viewer.id,
    demo,
    data.orderId,
    data.attemptId,
    mode,
    data.destination?.latitude,
    data.destination?.longitude,
  ];
  const query = useQuery<RouteResponse>({
    queryKey: key,
    enabled,
    staleTime: ROUTE_COOLDOWN_MS,
    gcTime: 0,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      requested.current = Date.now();
      const response = await fetch(`/api/orders/${data.orderId}/route`, {
        cache: "no-store",
        signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Road route unavailable.");
      return body.data;
    },
  });
  const route = enabled ? query.data?.route : null;
  useEffect(() => {
    if (
      !route ||
      !live ||
      query.isFetching ||
      Date.now() - requested.current < ROUTE_COOLDOWN_MS
    )
      return;
    if (shouldRefreshRoute(route, data))
      void client.invalidateQueries({ queryKey: key, exact: true });
  }, [data.point?.capturedAt, live, route, query.isFetching]);
  const progress = route
    ? routeProgress(
        route,
        mode === "planned" ? route.origin : (data.point ?? route.origin),
      )
    : null;
  const offRoute =
    !!progress &&
    mode === "delivery" &&
    live &&
    !!data.point &&
    data.point.accuracy <= 100 &&
    progress.offRoute > Math.max(80, data.point.accuracy * 2);
  const estimated = mode === "planned" || !live;
  const missing =
    data.state === "stopped"
      ? "Delivery ended. Live routing has stopped."
      : !data.destination
        ? "A destination pin is needed for a road route. Contact HQ to confirm the location."
        : !origin
          ? data.pickedUpAt
            ? "Waiting for GPS before calculating the road route."
            : "Planned routing needs a dispatch pin. After pickup, your GPS position can start the route."
          : "";
  const markers = [
    ...(data.source.pin && (data.point || data.destination)
      ? [
          {
            id: "source",
            pin: data.source.pin,
            label: `Collect from ${data.source.name}`,
            color: "#66756e",
          },
        ]
      : []),
    ...(data.destination && data.point
      ? [
          {
            id: "destination",
            pin: data.destination,
            label: "Delivery destination",
            color: "#17674f",
          },
        ]
      : []),
  ];
  return (
    <div
      className={`delivery-road-route${viewer.role === "driver" ? " driver-road-route" : ""}${focused ? " focused-road-route" : ""}`}
    >
      <div className="road-route-heading">
        <Route size={18} />
        <strong>
          {mode === "planned" ? "Planned road route" : "Delivery road route"}
        </strong>
        {query.isFetching && (
          <span role="status">{route ? "Updating…" : "Finding roads…"}</span>
        )}
      </div>
      {route && progress && (
        <>
          <div className="route-metrics" aria-label="Route estimate">
            <div>
              <small>
                {mode === "planned"
                  ? "Route distance"
                  : live
                    ? "Remaining distance"
                    : "Last estimated distance"}
              </small>
              <strong>{routeDistance(progress.remainingDistance)}</strong>
            </div>
            <div>
              <small>
                <Clock3 size={13} /> Estimated drive time
              </small>
              <strong>{routeTime(progress.remainingDuration)}</strong>
            </div>
            {mode === "delivery" && live && !offRoute && (
              <div>
                <small>Estimated arrival · Yangon</small>
                <strong>
                  {new Date(
                    now + progress.remainingDuration * 1000,
                  ).toLocaleTimeString("en-GB", {
                    timeZone: "Asia/Yangon",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </div>
            )}
          </div>
          <p className="route-estimate-note">
            {estimated
              ? mode === "planned"
                ? "Preview from the dispatch location. Live progress starts after pickup and GPS sharing."
                : "Last known location — this estimate is not live."
              : "Estimate from the current route; traffic is not included."}{" "}
            {data.point && data.point.accuracy > 100
              ? "GPS accuracy is low. Wait for a better fix before relying on progress."
              : ""}
          </p>
          {viewer.role === "driver" && (
            <div className="route-next-direction" role="status">
              <Navigation size={21} />
              <div>
                <small>
                  {offRoute
                    ? "Off route"
                    : mode === "planned"
                      ? "First direction"
                      : live
                        ? "Next direction"
                        : "Last route direction"}
                </small>
                <strong>
                  {offRoute
                    ? "Road route needs updating. Follow road signs while it recalculates."
                    : mode === "planned"
                      ? (route.steps[0]?.instruction ??
                        progress.nextInstruction)
                      : progress.nextInstruction}
                </strong>
                {!offRoute && progress.turnDistance > 20 && (
                  <span>In {routeDistance(progress.turnDistance)}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {(missing || query.error || query.data?.reason) && (
        <p className="inline-note route-unavailable" role="status">
          {missing || query.error?.message || query.data?.reason}{" "}
          {route
            ? "The last route is still shown below."
            : "Manual delivery updates remain available."}
        </p>
      )}
      {enabled && (
        <button
          type="button"
          className="text-link route-refresh"
          disabled={
            query.isFetching || now - requested.current < ROUTE_COOLDOWN_MS
          }
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={14} /> Refresh road route
        </button>
      )}
      {(data.point || data.destination || data.source.pin) && (
        <LocationMap
          key={data.attemptId ?? "unassigned"}
          pin={data.point ?? data.destination ?? data.source.pin ?? undefined}
          pinLabel={
            data.point
              ? "Driver's last reported location"
              : data.destination
                ? "Delivery destination"
                : "Dispatch source"
          }
          pinColor={
            data.point ? "#2868b2" : data.destination ? "#17674f" : "#66756e"
          }
          markers={markers}
          label="Delivery tracking"
          route={route?.geometry.coordinates}
          remainingRoute={
            mode === "delivery" &&
            live &&
            !offRoute &&
            data.point &&
            data.point.accuracy <= 100 &&
            progress
              ? progress.remainingCoordinates
              : undefined
          }
          navigation={viewer.role === "driver" && !!data.point && live}
        />
      )}
      {route && viewer.role === "driver" && (
        <details className="route-directions">
          <summary>Road directions · {route.steps.length} steps</summary>
          <ol>
            {route.steps.map((step, i) => (
              <li key={i}>
                <span>{step.instruction}</span>
                <small>{routeDistance(step.distance)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
