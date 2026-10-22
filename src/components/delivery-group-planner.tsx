"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Route } from "lucide-react";
import type { Viewer } from "@/lib/domain";
import type { LocationPin } from "@/lib/contact";
import { LocationPicker } from "./location-picker";
import {
  suggestStopOrder,
  type DispatchCandidates,
} from "@/lib/delivery-groups";

export function DeliveryGroupPlanner({ viewer }: { viewer: Viewer }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [driverId, setDriverId] = useState("");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [startingPoint, setStartingPoint] = useState<{
    source: string | null;
    pin: LocationPin;
  } | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const query = useQuery<DispatchCandidates>({
    queryKey: ["dispatch-candidates", viewer.id],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/delivery-groups", {
        signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Delivery planner unavailable.");
      return body.data;
    },
    staleTime: 10_000,
    retry: false,
    refetchInterval: false,
  });
  const orders = query.data?.orders ?? [];
  const chosen = selected.flatMap(
    (id) => orders.find((order) => order.id === id) ?? [],
  );
  const source = chosen[0]?.sourceBranchId;
  const origin =
    chosen[0]?.sourcePin ??
    (startingPoint && startingPoint.source === source
      ? startingPoint.pin
      : null);
  const drivers = (query.data?.drivers ?? []).filter(
    (driver) => !chosen.length || driver.branchId === source,
  );
  const assignment = useMutation({
    mutationFn: async () => {
      const payload = { orderIds: selected, driverId };
      const fingerprint = JSON.stringify(payload);
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch("/api/delivery-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, key: retry.current!.key }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not assign the delivery group.");
      return body.data as { message: string };
    },
    onSuccess: async (result) => {
      retry.current = null;
      setSelected([]);
      setSuggestion("");
      setStartingPoint(null);
      setMessage(result.message);
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["dispatch-candidates", viewer.id],
        }),
        client.invalidateQueries({ queryKey: ["workspace", viewer.id] }),
      ]);
    },
  });
  function move(index: number, change: number) {
    setSuggestion("");
    setSelected((previous) => {
      const next = [...previous];
      [next[index], next[index + change]] = [next[index + change], next[index]];
      return next;
    });
  }
  function suggest() {
    if (!origin) {
      setSuggestion("Choose the dispatch starting point on the map first.");
      return;
    }
    const next = suggestStopOrder(chosen, origin);
    const changed = next.some((order, index) => order.id !== selected[index]);
    setSelected(next.map((order) => order.id));
    setSuggestion(
      `${changed ? "Sequence updated." : "Already in nearest-stop order."} First drop-off: ${next[0].business} (${next[0].reference}).`,
    );
  }
  return (
    <section
      className="panel delivery-group-planner"
      aria-label="Grouped delivery planner"
    >
      <div className="panel-heading">
        <h2>
          <Route size={20} aria-hidden="true" /> Plan grouped deliveries
        </h2>
        <button
          className="text-link"
          type="button"
          disabled={query.isFetching || assignment.isPending}
          onClick={() => void query.refetch()}
        >
          Refresh orders
        </button>
      </div>
      <p className="muted">
        Choose two to eight confirmed orders from one fulfilment location, set
        their drop-off order, then assign one driver.
      </p>
      {query.isPending && <p role="status">Loading ready orders…</p>}
      {query.error && (
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && (
        <div className="group-planner-grid">
          <div>
            <h3>Ready to group</h3>
            <p className="muted">
              Up to 100 oldest ready orders. Grouped orders leave this list.
            </p>
            <div className="group-candidates">
              {orders.map((order) => (
                <label key={order.id} className="group-order-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(order.id)}
                    disabled={
                      assignment.isPending ||
                      (!selected.includes(order.id) &&
                        (selected.length >= 8 ||
                          (!!chosen.length && source !== order.sourceBranchId)))
                    }
                    onChange={(event) => {
                      setMessage("");
                      setSuggestion("");
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, order.id]
                          : previous.filter((id) => id !== order.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{order.business}</strong>
                    <small>{order.reference}</small>
                    <small>{order.sourceName}</small>
                  </span>
                </label>
              ))}
              {!orders.length && (
                <p>
                  No ungrouped orders are ready. Confirm payment and save
                  destination pins first.
                </p>
              )}
            </div>
          </div>
          <div>
            <h3>Drop-off sequence</h3>
            <button
              type="button"
              className="text-link group-clear"
              disabled={!selected.length || assignment.isPending}
              onClick={() => {
                setSelected([]);
                setSuggestion("");
                setStartingPoint(null);
              }}
            >
              Clear selection
            </button>
            {chosen.length > 0 && !chosen[0].sourcePin && (
              <div className="group-starting-point">
                <p className="muted">
                  {chosen[0].sourceName} has no saved dispatch pin. Choose where
                  the driver will collect these orders to suggest the first
                  stop. This pin is used only for this planning session.
                </p>
                <LocationPicker
                  key={source ?? "hq"}
                  required
                  label="Dispatch starting point"
                  initialPin={origin ?? undefined}
                  onChange={(pin) => {
                    setStartingPoint({ source: source ?? null, pin });
                    setSuggestion("");
                  }}
                />
              </div>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={chosen.length < 2 || assignment.isPending}
              onClick={suggest}
            >
              Suggest nearest stops
            </button>
            <p className="muted">
              Distance-based suggestion; review road access before assigning.
            </p>
            <div role="status" aria-live="polite" aria-atomic="true">
              {suggestion && <p className="inline-note">{suggestion}</p>}
            </div>
            <ol className="group-stop-list">
              {chosen.map((order, index) => (
                <li key={order.id}>
                  <span className="stop-badge">{index + 1}</span>
                  <span>
                    <strong>{order.business}</strong>
                    <small>{order.reference}</small>
                  </span>
                  <div>
                    <button
                      type="button"
                      className="button secondary icon-button"
                      aria-label={`Move stop ${index + 1} earlier`}
                      disabled={index === 0 || assignment.isPending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="button secondary icon-button"
                      aria-label={`Move stop ${index + 1} later`}
                      disabled={
                        index === chosen.length - 1 || assignment.isPending
                      }
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <label className="field">
              Driver
              <select
                aria-label="Driver for delivery group"
                value={driverId}
                disabled={assignment.isPending}
                onChange={(event) => setDriverId(event.target.value)}
              >
                <option value="">Choose a driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary"
              type="button"
              disabled={
                chosen.length < 2 ||
                chosen.length !== selected.length ||
                !drivers.some((driver) => driver.id === driverId) ||
                assignment.isPending
              }
              onClick={() => {
                setMessage("");
                assignment.mutate();
              }}
            >
              {assignment.isPending ? "Assigning…" : "Assign delivery group"}
            </button>
            <p className="muted">
              Prepare and dispatch each order, then the driver confirms physical
              pickup for each parcel. Each customer sees only their route and
              anonymous earlier stops.
            </p>
          </div>
        </div>
      )}
      {assignment.error && (
        <p className="form-error" role="alert">
          {assignment.error.message}
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
