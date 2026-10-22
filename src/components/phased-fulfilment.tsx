"use client";
import { useState } from "react";
import type { Branch, Order, Viewer } from "@/lib/domain";

export function PhasedFulfilment({
  order,
  viewer,
  branches,
  pending,
  act,
}: {
  order: Order;
  viewer: Viewer;
  branches: Branch[];
  pending: boolean;
  act: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const w = order.workflow!;
  const progress = w.fulfilment;
  const current = progress?.current;
  const [source, setSource] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const sourceBranch = branches.find((b) => b.id === source);
  const lines =
    progress?.lines ??
    w.lines.map((l) => ({ ...l, ordered: l.quantity, received: 0 }));
  const outstanding = lines
    .map((l) => ({ ...l, remaining: l.ordered - l.received }))
    .filter((l) => l.remaining > 0);
  const availability = (id: string, remaining: number) =>
    source === "hq"
      ? remaining
      : (sourceBranch?.inventory?.find((i) => i.productId === id)?.protected ??
        0);
  const selected = outstanding
    .map((l) => ({
      productId: l.productId,
      quantity: Number(
        quantities[l.productId] ??
          Math.min(l.remaining, availability(l.productId, l.remaining)),
      ),
    }))
    .filter((l) => l.quantity > 0);
  const valid =
    selected.length > 0 &&
    outstanding.every((l) => {
      const n = Number(
        quantities[l.productId] ??
          Math.min(l.remaining, availability(l.productId, l.remaining)),
      );
      return (
        Number.isInteger(n) &&
        n >= 0 &&
        n <= Math.min(l.remaining, availability(l.productId, l.remaining))
      );
    });
  const phaseNumber = (progress?.history.at(-1)?.number ?? 0) + 1;
  const status = progress?.deliveryStatus ?? order.status;
  const canPlan =
    viewer.role === "hq" &&
    !current &&
    w.paymentVerified &&
    w.reserved &&
    !w.sourceBranchId &&
    !w.dispatched &&
    !w.handoffPending &&
    !w.issue &&
    ["Confirmed", "Preparing"].includes(status);
  if (!progress && !canPlan) return null;
  return (
    <section
      className="workflow-section phased-fulfilment"
      aria-label="Phased fulfilment"
    >
      <h4>{progress ? "Delivery progress" : "Arrange fulfilment in phases"}</h4>
      {progress && (
        <>
          <dl className="phase-progress">
            <div>
              <dt>Received</dt>
              <dd>
                {progress.received} of {progress.ordered} pairs
              </dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{progress.remaining} pairs</dd>
            </div>
          </dl>
          {order.status === "Order remaining" && (
            <p className="inline-note">
              Order remaining. Each phase keeps its own delivery status. Done
              requires receipt and driver handover for every pair.
            </p>
          )}
          {current && (
            <div className="phase-current">
              <strong>
                Phase {current.number} · {current.pairs} pairs
              </strong>
              <p>
                {current.source} ·{" "}
                {current.state === "requested"
                  ? "Awaiting branch acceptance"
                  : status}
              </p>
              <ul>
                {current.lines.map((l) => (
                  <li key={l.productId}>
                    {l.name} · {l.variant} · {l.quantity} pairs
                  </li>
                ))}
              </ul>
              {current.received && (
                <p className="inline-note">
                  SME receipt recorded for this phase. Waiting for the driver’s
                  handover confirmation.
                </p>
              )}
            </div>
          )}
          <details className="phase-history">
            <summary>Phase history</summary>
            <ol>
              {progress.history.map((p) => (
                <li key={p.id}>
                  <strong>
                    Phase {p.number} · {p.pairs} pairs · {p.source}
                  </strong>
                  <small>
                    {p.state === "received"
                      ? "Receipt and driver handover confirmed"
                      : p.state === "cancelled"
                        ? "Cancelled"
                        : `${p.received ? "SME receipt recorded" : "Awaiting SME receipt"} · ${p.handover ? "Driver handover recorded" : "Awaiting driver handover"}`}
                  </small>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {canPlan && (
        <details open={!!progress} className="phase-plan">
          <summary>
            Plan phase {phaseNumber}
            {progress ? ` · ${progress.remaining} pairs outstanding` : ""}
          </summary>
          <p className="muted">
            Choose the source and quantities for this delivery. A branch can
            supply part of the order from its available wholesale backup stock.
            Undelivered pairs remain reserved at HQ; the price and payment stay
            unchanged.
          </p>
          <label className="field">
            Fulfilment source
            <select
              value={source}
              disabled={pending}
              onChange={(e) => {
                setSource(e.target.value);
                setQuantities({});
              }}
            >
              <option value="">Choose HQ or an open branch</option>
              <option value="hq">STT Yangon HQ</option>
              {branches
                .filter((b) => b.active !== false)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          {source && (
            <div className="phase-quantity-list">
              {outstanding.map((l) => {
                const max = Math.min(
                  l.remaining,
                  availability(l.productId, l.remaining),
                );
                return (
                  <label key={l.productId} className="phase-quantity">
                    <span>
                      <strong>
                        {l.name} · {l.variant}
                      </strong>
                      <small>
                        {l.remaining} outstanding · {max} available for this
                        phase
                      </small>
                    </span>
                    <span>
                      <span className="sr-only">
                        Phase pairs for {l.variant}
                      </span>
                      <input
                        aria-label={`Phase pairs for ${l.variant}`}
                        type="number"
                        min="0"
                        max={max}
                        step="1"
                        value={quantities[l.productId] ?? max}
                        disabled={pending}
                        onChange={(e) =>
                          setQuantities((previous) => ({
                            ...previous,
                            [l.productId]: e.target.value,
                          }))
                        }
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <label className="field">
            Phase reason
            <textarea
              value={reason}
              maxLength={500}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: branch supplies available pairs; HQ delivers the remaining pairs next."
            />
          </label>
          <p className="muted">
            {selected.reduce((n, l) => n + l.quantity, 0)} pairs in phase{" "}
            {phaseNumber}
          </p>
          <button
            type="button"
            className="button primary"
            disabled={pending || !source || !valid || reason.trim().length < 3}
            onClick={() =>
              act("phase_request", {
                branchId: source === "hq" ? null : source,
                lines: selected,
                reason,
              })
            }
          >
            {source === "hq"
              ? "Reserve phase at HQ"
              : "Request branch acceptance for this phase"}
          </button>
        </details>
      )}
      {viewer.role === "hq" && current && current.state !== "dispatched" && (
        <details className="phase-plan">
          <summary>Cancel this phase and replan</summary>
          <label className="field">
            Reason
            <textarea
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={pending || reason.trim().length < 3}
            onClick={() => act("phase_cancel", { reason })}
          >
            Cancel phase {current.number}
          </button>
        </details>
      )}
    </section>
  );
}
