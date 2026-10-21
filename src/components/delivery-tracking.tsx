"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Viewer } from "@/lib/domain";
import { locationIsFresh } from "@/lib/tracking";
import {
  readTracking,
  subscribeTracking,
  TrackingRequestError,
} from "@/lib/tracking-client";
import { LocationMap } from "./location-map";
import { useDriverTracking } from "./driver-tracking-provider";

export function DeliveryTracking({
  orderId,
  viewer,
  demo,
  refresh,
}: {
  orderId: string;
  viewer: Viewer;
  demo: boolean;
  refresh: () => Promise<unknown>;
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
  const active = publisher.trip?.attemptId === data.attemptId;
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
  const extras = [
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
    <section
      className="workflow-section delivery-tracking"
      aria-label="Delivery tracking"
    >
      <h4>Delivery location</h4>
      <p
        className={live ? "tracking-status live" : "tracking-status"}
        role="status"
      >
        {status}
      </p>
      <p className="muted">
        Collect from {data.source.name} · Deliver to the saved order location
      </p>
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
          pinColor={data.point ? "#2868b2" : "#17674f"}
          markers={extras}
          label="Delivery tracking"
        />
      )}
      <p className="tracking-legend">
        <span>Blue: driver</span>
        <span>Green: destination</span>
        <span>Grey: dispatch source, when pinned</span>
      </p>
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
    </section>
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
