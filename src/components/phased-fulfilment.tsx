"use client";
import { useEffect, useState } from "react";
import type { Branch, Order, Viewer } from "@/lib/domain";
import { metresBetween } from "@/lib/routing";

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
  const [returnedConsignmentConfirmed, setReturnedConsignmentConfirmed] =
    useState(false);
  const lines =
    progress?.lines ??
    w.lines.map((l) => ({ ...l, ordered: l.quantity, received: 0 }));
  const outstanding = lines
    .map((l) => ({ ...l, remaining: l.ordered - l.received }))
    .filter((l) => l.remaining > 0);
  const activeBranches = branches.filter((branch) => branch.active !== false);
  const branchBackup = (branch: Branch) =>
    outstanding.reduce(
      (total, line) =>
        total +
        Math.min(
          line.remaining,
          branch.inventory?.find((item) => item.productId === line.productId)
            ?.protected ?? 0,
        ),
      0,
    );
  const branchesWithBackup = activeBranches.filter(
    (branch) => branchBackup(branch) > 0,
  );
  // Proximity is the primary recommendation. Backup only determines whether a
  // branch can contribute; the selected quantity determines full vs phased.
  const recommendedBranch = order.pin
    ? [...branchesWithBackup].sort((a, b) => {
        if (a.pin && b.pin) {
          return (
            metresBetween(order.pin!, a.pin) - metresBetween(order.pin!, b.pin)
          );
        }
        if (a.pin) return -1;
        if (b.pin) return 1;
        return (
          branchBackup(b) - branchBackup(a) || a.name.localeCompare(b.name)
        );
      })[0]
    : [...branchesWithBackup].sort(
        (a, b) =>
          branchBackup(b) - branchBackup(a) || a.name.localeCompare(b.name),
      )[0];
  const recommendedSource = recommendedBranch?.id ?? "hq";
  const selectedSource = source || recommendedSource;
  const sourceBranch = branches.find((b) => b.id === selectedSource);
  useEffect(() => {
    setSource("");
    setQuantities({});
    setReason("");
    setReturnedConsignmentConfirmed(false);
  }, [order.id]);
  const availability = (id: string, remaining: number) =>
    selectedSource === "hq"
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
  const phaseQuantity = selected.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const stockCoversFullOrder =
    selectedSource === "hq" ||
    (!!selectedSource &&
      outstanding.every(
        (line) =>
          availability(line.productId, line.remaining) >= line.remaining,
      ));
  const canDeliverInOneTrip =
    stockCoversFullOrder &&
    outstanding.every(
      (line) =>
        Number(
          quantities[line.productId] ??
            Math.min(
              line.remaining,
              availability(line.productId, line.remaining),
            ),
        ) === line.remaining,
    );
  const defaultPhaseReason = canDeliverInOneTrip
    ? `Full delivery planned from ${selectedSource === "hq" ? "HQ" : (sourceBranch?.name ?? "the selected branch")} for ${phaseQuantity} pairs.`
    : `${selectedSource === "hq" ? "HQ" : (sourceBranch?.name ?? "The selected branch")} phase planned for ${phaseQuantity} pairs.`;
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
  const priorRecoveryReady =
    !!w.replacementRequired && !w.handoffPending && !progress;
  const dispatchedRecovery =
    !!w.dispatched &&
    !!w.issue &&
    !w.handoffPending &&
    !progress &&
    status === "On hold";
  const recoveryReady = priorRecoveryReady || dispatchedRecovery;
  const recoveryConfirmed =
    !dispatchedRecovery || priorRecoveryReady || returnedConsignmentConfirmed;
  const canPlan =
    viewer.role === "hq" &&
    !current &&
    w.paymentVerified &&
    w.reserved &&
    !w.sourceBranchId &&
    (!w.issue || recoveryReady) &&
    ((!w.dispatched &&
      !w.handoffPending &&
      ["Confirmed", "Preparing"].includes(status)) ||
      dispatchedRecovery);
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
          <label className="field">
            Fulfilment source
            <select
              value={selectedSource}
              disabled={pending}
              onChange={(e) => {
                setSource(e.target.value);
                setQuantities({});
              }}
            >
              <option value="hq">Ocean Pride Longyi HQ</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {selectedSource && (
            <>
              <div className="inline-note phase-recommendation" role="status">
                <strong>
                  {canDeliverInOneTrip
                    ? "Full delivery"
                    : `Phased delivery · ${phaseQuantity} pairs`}
                </strong>
              </div>
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
            </>
          )}
          {dispatchedRecovery && !priorRecoveryReady && (
            <label className="workflow-checkbox">
              <input
                type="checkbox"
                checked={returnedConsignmentConfirmed}
                disabled={pending}
                onChange={(event) =>
                  setReturnedConsignmentConfirmed(event.target.checked)
                }
              />
              I confirm all originally dispatched pairs were physically returned
              to HQ.
            </label>
          )}
          <label className="field">
            Phase reason (optional)
            <textarea
              value={reason}
              maxLength={500}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Add an internal note (optional)"
            />
          </label>
          <p className="muted">
            {phaseQuantity} pairs in{" "}
            {canDeliverInOneTrip ? "full delivery" : `phase ${phaseNumber}`}
          </p>
          <button
            type="button"
            className="button primary"
            disabled={
              pending || !selectedSource || !valid || !recoveryConfirmed
            }
            onClick={() =>
              act("phase_request", {
                branchId: selectedSource === "hq" ? null : selectedSource,
                lines: selected,
                reason: reason.trim() || defaultPhaseReason,
                ...(dispatchedRecovery && !priorRecoveryReady
                  ? { returnedConsignmentConfirmed: true }
                  : {}),
              })
            }
          >
            {selectedSource === "hq"
              ? canDeliverInOneTrip
                ? "Reserve full delivery at HQ"
                : `Reserve HQ phase · ${phaseQuantity} pairs`
              : canDeliverInOneTrip
                ? "Request full branch delivery"
                : `Request branch phase · ${phaseQuantity} pairs`}
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
