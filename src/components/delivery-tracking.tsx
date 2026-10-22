"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Viewer } from "@/lib/domain";
import { locationIsFresh } from "@/lib/tracking";
import {
  readTracking,
  subscribeTracking,
  TrackingRequestError,
} from "@/lib/tracking-client";
import { DeliveryRoute } from "./delivery-route";
import { useDriverTracking } from "./driver-tracking-provider";

function DeliveryLocationSection({
  driver,
  focused,
  children,
}: {
  driver: boolean;
  focused: boolean;
  children: ReactNode;
}) {
  if (focused)
    return (
      <section
        className="delivery-tracking route-only-tracking"
        aria-label="Delivery navigation"
      >
        {children}
      </section>
    );
  if (driver)
    return (
      <details className="workflow-section delivery-tracking" open>
        <summary>Delivery location</summary>
        {children}
      </details>
    );
  return (
    <section
      className="workflow-section delivery-tracking"
      aria-label="Delivery tracking"
    >
      <h4>Delivery location</h4>
      {children}
    </section>
  );
}

export function DeliveryTracking({
  orderId,
  viewer,
  demo,
  refresh,
  focused = false,
}: {
  orderId: string;
  viewer: Viewer;
  demo: boolean;
  refresh: () => Promise<unknown>;
  focused?: boolean;
}) {
  const client = useQueryClient();
  const publisher = useDriverTracking();
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now);
  const metadata = useRef("");
  const onRefresh = useRef(refresh);
  onRefresh.current = refresh;
  const key = ["delivery-tracking", viewer.id, demo, orderId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readTracking(orderId, signal),
    staleTime: 10_000,
    refetchInterval: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (count, error) =>
      count < 1 &&
      !(error instanceof TrackingRequestError && error.status < 500),
  });
  const data = query.data;
  const denied =
    query.error instanceof TrackingRequestError &&
    [401, 403].includes(query.error.status);
  useEffect(() => {
    if (denied) return;
    return subscribeTracking(
      orderId,
      demo,
      () => {
        void client.invalidateQueries({
          queryKey: ["delivery-tracking", viewer.id, demo, orderId],
        });
      },
      setConnected,
    );
  }, [client, viewer.id, demo, orderId, denied]);
  useEffect(() => {
    if (!data) return;
    const next = JSON.stringify([data.attemptId, data.pickedUpAt, data.status]);
    if (metadata.current && metadata.current !== next)
      void onRefresh.current().catch(() => {});
    metadata.current = next;
  }, [data]);
  useEffect(() => {
    // A local clock marks stale fixes; it never fetches workspace data.
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  if (query.error)
    return (
      <p className="inline-note" role="status">
        {query.error.message}
      </p>
    );
  if (!data) return <p role="status">Loading delivery location…</p>;
  const live = connected && locationIsFresh(data, now);
  const canResume =
    viewer.role === "driver" && data.canPublish && !!data.attemptId;
  const active =
    publisher.trip?.attemptId === data.attemptId ||
    !!(
      publisher.trip &&
      data.run?.stops.some((stop) => stop.orderId === publisher.trip?.orderId)
    );
  const status =
    data.state === "stopped"
      ? "Location sharing ended"
      : !data.pickedUpAt
        ? "Awaiting driver pickup"
        : data.state === "paused" || !data.canPublish
          ? "Location sharing paused"
          : live
            ? "Live driver location"
            : "Location temporarily unavailable";
  return (
    <DeliveryLocationSection
      driver={viewer.role === "driver"}
      focused={focused}
    >
      {focused && (
        <button
          type="button"
          className="text-link route-refresh"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh location
        </button>
      )}
      <p
        className={live ? "tracking-status live" : "tracking-status"}
        role="status"
      >
        {status}
      </p>
      <p className="muted">
        Collect from {data.source.name} · Deliver to the saved order location
      </p>
      {!data.point && (
        <p className="inline-note tracking-location-help">
          {data.state === "stopped"
            ? "Location sharing has ended for this delivery. No driver GPS position is available."
            : !data.pickedUpAt
              ? viewer.role === "driver"
                ? "Your blue driver pin appears after you select Confirm pickup & start delivery and allow GPS access. No driver location has been shared for this order yet."
                : "No driver location has been shared yet. The blue driver pin appears after pickup is confirmed and the driver shares a GPS location."
              : canResume
                ? "No driver GPS position has been received yet. Allow location access and keep Supply Link open. If sharing is paused, resume it below."
                : "No driver GPS position is available for this delivery."}
        </p>
      )}
      <DeliveryRoute
        data={data}
        viewer={viewer}
        demo={demo}
        live={live}
        now={now}
        focused={focused}
      />
      {(data.point || data.destination || data.source.pin) && (
        <p className="tracking-legend">
          {data.point && (
            <span>
              Blue: {live ? "driver" : "driver’s last known position"}
            </span>
          )}
          {data.destination && <span>Green: destination</span>}
          {data.run?.stops.some((stop) => !stop.own) && (
            <span>
              Amber:{" "}
              {viewer.role === "sme" ? "earlier stops" : "other drop-offs"}
            </span>
          )}
          {data.source.pin && <span>Grey: dispatch source</span>}
        </p>
      )}
      {data.point && (
        <p className="muted">
          {live ? "Updated" : "Last known position"}:{" "}
          {new Date(data.point.capturedAt).toLocaleTimeString("en-GB", {
            timeZone: "Asia/Yangon",
          })}{" "}
          Yangon · GPS accuracy ±{Math.round(data.point.accuracy)} m
        </p>
      )}
      {data.pickedUpAt && (
        <p className="muted">
          Pickup confirmed{" "}
          {new Date(data.pickedUpAt).toLocaleString("en-GB", {
            timeZone: "Asia/Yangon",
          })}{" "}
          Yangon
        </p>
      )}
      {!connected && (
        <p className="muted">
          Live connection unavailable. Reconnecting; refresh status to check
          manually.
        </p>
      )}
      {canResume && (!active || publisher.paused) && (
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            publisher.begin({
              orderId,
              attemptId: data.attemptId!,
              viewerId: viewer.id,
              demo,
              reference: data.reference,
            })
          }
        >
          Resume live location
        </button>
      )}
      {canResume && active && !publisher.paused && (
        <button
          type="button"
          className="button secondary"
          onClick={publisher.pause}
        >
          Pause location sharing
        </button>
      )}
      {active && (
        <p className="muted" role="status">
          {publisher.message}
        </p>
      )}
    </DeliveryLocationSection>
  );
}

export function DriverTrackingNotice({ viewer }: { viewer: Viewer }) {
  const tracker = useDriverTracking();
  useEffect(() => {
    tracker.identify(viewer);
  }, [viewer.id]);
  if (viewer.role !== "driver" || tracker.trip?.viewerId !== viewer.id)
    return null;
  return (
    <aside className="tracking-notice" aria-label="Location sharing">
      <div>
        <strong>{tracker.trip.reference}</strong>
        <p role="status">{tracker.message}</p>
      </div>
      <button
        className="button secondary"
        type="button"
        onClick={tracker.paused ? tracker.resume : tracker.pause}
      >
        {tracker.paused ? "Resume live location" : "Pause location sharing"}
      </button>
    </aside>
  );
}
