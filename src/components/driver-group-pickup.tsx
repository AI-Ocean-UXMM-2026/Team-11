"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Viewer } from "@/lib/domain";
import type {
  DriverDeliveryGroup,
  DriverGroupResult,
} from "@/lib/delivery-groups";
import { statusToneClass } from "@/lib/status-tone";
import { useDriverTracking } from "./driver-tracking-provider";

async function requestGroups<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/driver/delivery-groups", {
    cache: "no-store",
    ...init,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Group pickup is unavailable.");
  return body.data;
}

function PickupGroup({
  group,
  viewer,
  demo,
  refresh,
  from,
}: {
  group: DriverDeliveryGroup;
  viewer: Viewer;
  demo: boolean;
  refresh: () => Promise<unknown>;
  from: "overview" | "deliveries";
}) {
  const client = useQueryClient();
  const tracker = useDriverTracking();
  const [checked, setChecked] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const selected = checked.filter((id) =>
    group.stops.some((stop) => stop.orderId === id && stop.canPickup),
  );
  const next = group.stops.find((stop) => stop.canDeliver);
  const mutation = useMutation({
    mutationFn: (action: "accept" | "pickup") => {
      const payload = {
        runId: group.id,
        action,
        orderIds: action === "pickup" ? selected : [],
      };
      const fingerprint = JSON.stringify(payload);
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      return requestGroups<DriverGroupResult>({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, key: retry.current.key }),
      });
    },
    onSuccess: async (result, action) => {
      retry.current = null;
      setChecked([]);
      setMessage(result.message);
      if (action === "pickup" && result.publisher)
        tracker.begin({ ...result.publisher, viewerId: viewer.id, demo });
      await Promise.allSettled([
        client.invalidateQueries({
          queryKey: ["driver-delivery-groups", viewer.id, demo],
        }),
        client.invalidateQueries({ queryKey: ["workspace", viewer.id] }),
        client.invalidateQueries({
          queryKey: ["delivery-tracking", viewer.id],
        }),
        refresh(),
      ]);
    },
  });
  return (
    <section
      className="driver-pickup-group"
      aria-label={`Delivery group from ${group.sourceName}`}
    >
      <div className="heading-inline">
        <h3>Collect from {group.sourceName}</h3>
        <span
          className={`status-badge ${statusToneClass(group.acceptedAt ? "Accepted" : "Awaiting acceptance")}`}
        >
          {group.acceptedAt ? "Accepted" : "Awaiting acceptance"}
        </span>
      </div>
      {!group.acceptedAt ? (
        <>
          <p className="muted">
            Review this group, then accept it. Accepting does not start location
            sharing.
          </p>
          <button
            type="button"
            className="button primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("accept")}
          >
            {mutation.isPending ? "Accepting…" : "Accept delivery group"}
          </button>
        </>
      ) : (
        <p className="muted">
          Check only the parcels you have physically collected. Parcels awaiting
          dispatch or on hold cannot be checked.
        </p>
      )}
      <ol className="group-pickup-list">
        {group.stops.map((stop) => (
          <li key={stop.attemptId}>
            <label className="group-order-option">
              <input
                type="checkbox"
                aria-label={`Collected ${stop.reference}`}
                checked={selected.includes(stop.orderId)}
                disabled={
                  !group.acceptedAt || !stop.canPickup || mutation.isPending
                }
                onChange={(e) =>
                  setChecked((previous) =>
                    e.target.checked
                      ? [...previous, stop.orderId]
                      : previous.filter((id) => id !== stop.orderId),
                  )
                }
              />
              <span>
                <strong>
                  {stop.position}. {stop.business}
                </strong>
                <small>
                  {stop.reference} · {stop.pairs} pairs
                </small>
                <small>
                  {!stop.active
                    ? "Removed from active route"
                    : stop.pickedUpAt
                      ? stop.canDeliver
                        ? "Pickup confirmed · On your route"
                        : "Pickup confirmed · Delivery paused or handed over"
                      : stop.canPickup
                        ? "Ready for collection"
                        : `${stop.status} · Waiting for dispatch or issue resolution`}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ol>
      {group.acceptedAt && group.stops.some((stop) => stop.canPickup) && (
        <>
          <p className="muted">
            {selected.length} parcel{selected.length === 1 ? "" : "s"} checked.
            Location will be shared with HQ and the customers of picked-up
            parcels while Supply Link stays open. Allow GPS when asked. You can
            pause sharing; manual handover stays available.
          </p>
          <button
            type="button"
            className="button primary"
            disabled={!selected.length || mutation.isPending}
            onClick={() => mutation.mutate("pickup")}
          >
            {mutation.isPending
              ? "Confirming pickup…"
              : "Confirm pickup & start route"}
          </button>
        </>
      )}
      {next && (
        <Link
          className="button secondary open-delivery-view"
          href={`/driver/deliveries/${next.orderId}?from=${from}`}
        >
          Open group delivery view
        </Link>
      )}
      {mutation.error && (
        <p className="form-error" role="alert">
          {mutation.error.message}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

export function DriverGroupPickup({
  viewer,
  demo,
  refresh,
  orderId,
  fallback,
  from = "deliveries",
}: {
  viewer: Viewer;
  demo: boolean;
  refresh: () => Promise<unknown>;
  orderId?: string;
  fallback?: ReactNode;
  from?: "overview" | "deliveries";
}) {
  const query = useQuery({
    queryKey: ["driver-delivery-groups", viewer.id, demo],
    queryFn: ({ signal }) => requestGroups<DriverDeliveryGroup[]>({ signal }),
    staleTime: 10_000,
    retry: false,
    refetchInterval: false,
  });
  const groups =
    query.data?.filter(
      (group) =>
        !orderId || group.stops.some((stop) => stop.orderId === orderId),
    ) ?? [];
  if (query.isPending) return <p role="status">Loading delivery groups…</p>;
  if (query.error)
    return (
      <div>
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
        <button
          type="button"
          className="button secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry pickup groups
        </button>
      </div>
    );
  if (!groups.length) return <>{fallback}</>;
  return (
    <section
      className="panel driver-group-pickup"
      aria-label="Group acceptance and pickup"
    >
      <div className="panel-heading">
        <h2>Group pickup</h2>
        <button
          type="button"
          className="text-link"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh groups
        </button>
      </div>
      {groups.map((group) => (
        <PickupGroup
          key={group.id}
          group={group}
          viewer={viewer}
          demo={demo}
          refresh={refresh}
          from={from}
        />
      ))}
    </section>
  );
}
