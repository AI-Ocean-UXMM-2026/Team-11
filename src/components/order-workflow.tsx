"use client";
import Link from "next/link";
import { PaymentDestinations } from "./payment-destinations";
import { LocationLink } from "./location-link";
import { DeliveryTracking } from "./delivery-tracking";
import { useDriverTracking } from "./driver-tracking-provider";
import { useQueryClient } from "@tanstack/react-query";
import { DriverGroupPickup } from "./driver-group-pickup";
import { PhasedFulfilment } from "./phased-fulfilment";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Truck,
  Upload,
} from "lucide-react";
import { workflowAction } from "@/app/workflow-actions";
import { planningRequest } from "@/lib/stock-planning-client";
import { readTracking } from "@/lib/tracking-client";
import {
  money,
  total,
  type Order,
  type Viewer,
  type Account,
  type Branch,
  type WorkspaceData,
} from "@/lib/domain";

import type { WorkspaceQuery } from "@/lib/workflow/query";

export function OrderWorkflow({
  order,
  viewer,
  accounts,
  branches,
  updated,
  query = {},
  refresh,
  demo,
  paymentInstructions,
  deliveryOrigin = "deliveries",
  onReceiptConfirmed,
}: {
  demo: boolean;
  paymentInstructions?: string;
  deliveryOrigin?: "overview" | "deliveries";
  onReceiptConfirmed?: (message: string) => void;
  refresh: () => Promise<unknown>;
  query?: WorkspaceQuery;
  order: Order;
  viewer: Viewer;
  accounts: Account[];
  branches: Branch[];
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
}) {
  const w = order.workflow;
  const deliveryStatus = w?.fulfilment?.deliveryStatus ?? order.status;
  const tracker = useDriverTracking();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [reason, setReason] = useState("");
  const [driver, setDriver] = useState(w?.driverId ?? "");
  const [checked, setChecked] = useState(false);
  const [amount, setAmount] = useState("");
  const [fullReceipt, setFullReceipt] = useState(false);
  const uploadRetry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [backupBranch, setBackupBranch] = useState("");
  const [declineCause, setDeclineCause] = useState("");
  const [planningNotice, setPlanningNotice] = useState("");
  const [originalResolution, setOriginalResolution] =
    useState("returned_to_hq");
  const [consignmentResolved, setConsignmentResolved] = useState(false);
  useEffect(() => setDriver(w?.driverId ?? ""), [w?.driverId]);
  if (!w) return <p>Refresh this order to load its workflow.</p>;
  const hq = viewer.role === "hq",
    sme = viewer.role === "sme",
    isDriver = viewer.role === "driver";
  const branch = viewer.role === "branch";
  const canFulfil = hq || (branch && viewer.branchId === w.sourceBranchId);
  const privateFinance = hq || sme;
  const pendingHandoff = w.handoffs?.find((h) => h.status === "pending");
  const latest = w.evidence[0];
  const terminal = ["Done", "Cancelled"].includes(deliveryStatus);
  function act(action: string, payload: Record<string, unknown> = {}) {
    const body = {
      orderId: order.id,
      ...(w?.fulfilment?.current ? { phaseId: w.fulfilment.current.id } : {}),
      ...payload,
    };
    const fingerprint = JSON.stringify([action, body]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const key = retry.current.key;
    setError("");
    start(async () => {
      try {
        if (action === "record_unmet_backup") {
          const result = await planningRequest({
            action: "unmet",
            orderId: order.id,
            reason: payload.reason,
            key,
          });
          retry.current = null;
          setPlanningNotice(result.message);
          await refresh();
          return;
        }
        const result = await workflowAction(action, body, key, query);
        if (result.error) {
          setError(result.error);
          return;
        }
        retry.current = null;
        if (viewer.role === "driver")
          void queryClient.invalidateQueries({
            queryKey: ["driver-delivery-groups", viewer.id, demo],
          });
        if (action === "handover" && tracker.trip?.orderId === order.id) {
          try {
            const next = await readTracking(order.id);
            if (next.run?.publisher)
              tracker.begin({ ...tracker.trip, ...next.run.publisher });
            else tracker.end();
          } catch {
            tracker.end();
          }
        }
        if (action === "pickup" && result.result?.attemptId)
          tracker.begin({
            orderId: order.id,
            attemptId: result.result.attemptId,
            viewerId: viewer.id,
            demo,
            reference: order.reference,
          });
        if (result.data) {
          await updated(result.data, result.result?.message);
          if (action === "receive" && sme) {
            const receivedOrder =
              result.data.selectedOrder ??
              result.data.orders.find((item) => item.id === order.id);
            onReceiptConfirmed?.(
              `${w?.fulfilment?.current ? `Phase ${w.fulfilment.current.number} receipt recorded` : "Full receipt confirmed"} for ${order.reference}. ${
                receivedOrder?.status === "Done"
                  ? "Your order is complete."
                  : receivedOrder?.workflow?.fulfilment?.remaining
                    ? `${receivedOrder.workflow.fulfilment.remaining} pairs remaining.`
                    : "Awaiting driver handover."
              }`,
            );
          }
        }
      } catch {
        setError(
          "Connection interrupted. Retry the same action to check its recorded result.",
        );
      }
    });
  }
  function upload(form: HTMLFormElement) {
    const values = new FormData(form);
    const file = values.get("file") as File;
    const fingerprint = JSON.stringify([
      file?.name,
      file?.size,
      file?.lastModified,
      values.get("reference"),
      values.get("amount"),
    ]);
    if (uploadRetry.current?.fingerprint !== fingerprint)
      uploadRetry.current = { fingerprint, key: crypto.randomUUID() };
    values.set("operationKey", uploadRetry.current.key);
    values.set("query", JSON.stringify(query));
    setError("");
    start(async () => {
      try {
        const response = await fetch(`/api/orders/${order.id}/evidence`, {
          method: "POST",
          body: values,
        });
        const result = await response.json();
        if (!response.ok || result.error) {
          setError(result.error ?? "Upload failed.");
          if (result.error?.includes("Upload a validated proof image"))
            uploadRetry.current = null;
          return;
        }
        uploadRetry.current = null;
        await updated(result.data, result.result?.message);
        form.reset();
      } catch {
        setError(
          "Upload interrupted. Keep your details and retry the submission.",
        );
      }
    });
  }
  const locationPanel =
    (hq || sme) && w.attemptId ? (
      <DeliveryTracking
        orderId={order.id}
        viewer={viewer}
        demo={demo}
        refresh={refresh}
      />
    ) : null;
  return (
    <div className="modal-form workflow-detail" aria-busy={pending}>
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">STT WHOLESALE</span>
          <h3>{sme ? "Order status" : order.business}</h3>
          {!sme && <p className="muted">{order.location}</p>}
        </div>
        <span className="workflow-status">{order.status}</span>
      </div>
      <button
        type="button"
        className="text-link workflow-refresh"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              await refresh();
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Refresh failed.",
              );
            }
          })
        }
      >
        <RefreshCw size={14} />
        Refresh status
      </button>
      <PhasedFulfilment
        order={order}
        viewer={viewer}
        branches={branches}
        pending={pending}
        act={act}
      />
      <ul className="workflow-lines">
        {w.lines.map((l) => (
          <li key={l.productId}>
            <span>
              <strong>{l.name}</strong>
              <small>
                {l.variant} · {l.quantity} pairs
              </small>
            </span>
            {privateFinance && (
              <strong>{money((l.unitPrice ?? 0) * l.quantity)} MMK</strong>
            )}
          </li>
        ))}
      </ul>
      {privateFinance && (
        <dl className="detail-list">
          <div>
            <dt>Merchandise</dt>
            <dd>{money(order.merchandise)} MMK</dd>
          </div>
          <div>
            <dt>Shipping · Yangon</dt>
            <dd>{money(order.shipping)} MMK</dd>
          </div>
          <div className="total-row">
            <dt>Full quoted total</dt>
            <dd>{money(total(order))} MMK</dd>
          </div>
        </dl>
      )}
      {!sme && (
        <div className="workflow-contact">
          <Truck size={18} />
          <div>
            <strong>{w.receiver}</strong>
            <p>
              {w.phone} · {order.location}
            </p>
            {w.notes && <p>{w.notes}</p>}
            {order.pin && (
              <LocationLink pin={order.pin} label="Open delivery pin in map" />
            )}
            <small>Driver: {w.driverName ?? "Awaiting assignment"}</small>
          </div>
        </div>
      )}
      {sme && w.driverName && <p className="muted">Driver: {w.driverName}</p>}
      {(hq || sme || isDriver) &&
        w.attemptId &&
        (!w.fulfilment || w.fulfilment.current?.attemptId === w.attemptId) && (
          <>
            {isDriver && (
              <Link
                className="button secondary open-delivery-view"
                href={`/driver/deliveries/${order.id}?from=${deliveryOrigin}`}
              >
                Open delivery view
              </Link>
            )}
            {locationPanel}
          </>
        )}
      {privateFinance && (
        <div className="workflow-checks">
          {[
            [w.paymentVerified, "Payment verified"],
            [w.reserved, "Stock reserved"],
            [w.handover || order.status === "Done", "Driver handover"],
            [w.received, "SME received"],
          ].map(([done, label]) => (
            <span key={String(label)} className={done ? "checked" : ""}>
              {done ? <CheckCircle2 size={15} /> : <Clock3 size={15} />} {label}
            </span>
          ))}
        </div>
      )}
      {w.issue && (
        <div className="form-error" role="status">
          <strong>Order on hold</strong>
          <p>{w.issue}</p>
        </div>
      )}
      {w.refundRequired && (
        <div className="inline-note">
          Verified payment needs a refund follow-up from HQ. No refund has been
          processed by this app.
        </div>
      )}
      {privateFinance && !w.paymentVerified && (
        <section className="workflow-section">
          <h4>
            <ShieldCheck size={17} />
            Payment evidence
          </h4>
          {sme && (
            <PaymentDestinations
              instructions={w.instructions}
              currentInstructions={paymentInstructions}
              amount={total(order)}
              demo={demo}
              paymentConfirmed={w.paymentVerified}
            />
          )}
          {w.evidence.map((e) => (
            <div className="evidence-row" key={e.id}>
              <div>
                <strong>
                  Proof {e.version} · {e.status}
                </strong>
                <small>
                  {e.reference} · {money(e.amount)} MMK
                </small>
                {e.reason && <small>{e.reason}</small>}
              </div>
              <a
                className="text-link"
                href={`/api/orders/${order.id}/evidence/${e.id}`}
                target="_blank"
                rel="noreferrer"
              >
                View private proof
              </a>
            </div>
          ))}
          {sme &&
            !w.paymentVerified &&
            ["Draft", "Awaiting verification"].includes(deliveryStatus) && (
              <form
                className="workflow-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  upload(e.currentTarget);
                }}
              >
                <label className="field">
                  Payment screenshot
                  <input
                    type="file"
                    name="file"
                    accept="image/png,image/jpeg"
                    required
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Transfer reference
                    <input
                      name="reference"
                      minLength={3}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label className="field">
                    Full transferred amount (MMK)
                    <input
                      name="amount"
                      type="number"
                      min={1}
                      step={1}
                      required
                      defaultValue={total(order)}
                    />
                  </label>
                </div>
                <small className="muted">
                  PNG or JPEG, up to 5 MB. HQ verifies the actual receiving
                  account. Uploading does not confirm payment.
                </small>
                <button className="button primary" disabled={pending}>
                  <Upload size={16} />
                  {pending ? "Submitting…" : "Submit payment evidence"}
                </button>
              </form>
            )}
          {hq &&
            latest?.status === "pending" &&
            deliveryStatus === "Awaiting verification" &&
            !w.paymentVerified && (
              <div className="workflow-form">
                <label className="field">
                  Actual received amount (MMK)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="workflow-checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  I checked this transfer in the actual receiving account.
                </label>
                <div className="workflow-buttons">
                  <button
                    className="button primary"
                    disabled={pending || !checked || !amount}
                    onClick={() =>
                      act("review_payment", {
                        evidenceId: latest.id,
                        decision: "approve",
                        verifiedAmount: Number(amount),
                        bankChecked: checked,
                      })
                    }
                  >
                    Verify payment & reserve
                  </button>
                  <button
                    className="button secondary"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() =>
                      act("review_payment", {
                        evidenceId: latest.id,
                        decision: "reject",
                        reason,
                      })
                    }
                  >
                    Reject proof
                  </button>
                </div>
              </div>
            )}
        </section>
      )}
      {hq && w.paymentVerified && !w.reserved && !terminal && (
        <section className="workflow-section">
          <h4>Stock reservation</h4>
          <button
            className="button primary"
            disabled={pending}
            onClick={() => act("confirm")}
          >
            Retry stock reservation
          </button>
        </section>
      )}

      {pendingHandoff && (
        <section className="workflow-section">
          <h4>Backup request · {pendingHandoff.branchName}</h4>
          <p className="muted">{pendingHandoff.reason}</p>
          <p className="inline-note">
            Original consignment: {pendingHandoff.resolution}
          </p>
          {branch && viewer.branchId === pendingHandoff.branchId && (
            <div className="workflow-form">
              <p>
                Accepting reserves{" "}
                {w.fulfilment?.current
                  ? `only the ${w.fulfilment.current.pairs} pairs in phase ${w.fulfilment.current.number}`
                  : "every ordered pair"}{" "}
                from dedicated wholesale backup stock. Retail stock stays
                separate. Assign one of your branch drivers after acceptance.
              </p>
              <button
                className="button primary"
                disabled={pending}
                onClick={() =>
                  act("handoff_accept", { handoffId: pendingHandoff.id })
                }
              >
                {w.fulfilment?.current
                  ? `Accept & reserve ${w.fulfilment.current.pairs} pairs`
                  : "Accept & reserve branch stock"}
              </button>
              <label className="field">
                Reason if declining
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </label>
              <label className="field">
                Decline category
                <select
                  value={declineCause}
                  onChange={(e) => setDeclineCause(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  <option value="stock_shortage">Insufficient stock</option>
                  <option value="capacity">
                    Delivery or staffing capacity
                  </option>
                  <option value="other">Other reason</option>
                </select>
              </label>
              <button
                className="button secondary"
                disabled={pending || reason.trim().length < 3 || !declineCause}
                onClick={() =>
                  act("handoff_decline", {
                    handoffId: pendingHandoff.id,
                    reason,
                    declineCause,
                  })
                }
              >
                Decline request
              </button>
            </div>
          )}
          {hq && (
            <div className="workflow-form">
              <label className="field">
                Reason to cancel request
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </label>
              <button
                className="button secondary"
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  act("handoff_cancel", {
                    handoffId: pendingHandoff.id,
                    reason,
                  })
                }
              >
                Cancel branch request
              </button>
            </div>
          )}
        </section>
      )}
      {hq &&
        !w.fulfilment &&
        (w.sourceBranchId || w.dispatched) &&
        !terminal &&
        !w.handoffPending &&
        w.paymentVerified &&
        w.reserved &&
        !w.received &&
        ["Confirmed", "Preparing", "On hold"].includes(deliveryStatus) && (
          <details className="workflow-section">
            <summary>Arrange fulfilment from a branch</summary>
            <div className="workflow-form">
              <label className="field">
                Receiving branch
                <select
                  value={backupBranch}
                  onChange={(e) => setBackupBranch(e.target.value)}
                >
                  <option value="">Choose an open branch</option>
                  {branches
                    .filter(
                      (b) => b.active !== false && b.id !== w.sourceBranchId,
                    )
                    .map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name} · {b.stock} pairs on hand
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Handoff / resolution reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </label>
              {deliveryStatus === "On hold" && (
                <>
                  <button
                    className="button secondary"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() => act("record_unmet_backup", { reason })}
                  >
                    Record no branch can fulfil
                  </button>
                  {planningNotice && <p role="status">{planningNotice}</p>}
                </>
              )}
              {w.dispatched && !w.replacementRequired && (
                <>
                  <label className="field">
                    Original consignment outcome
                    <select
                      value={originalResolution}
                      onChange={(e) => setOriginalResolution(e.target.value)}
                    >
                      <option value="returned_to_hq">
                        All original pairs physically returned to HQ
                      </option>
                      <option value="lost">
                        Original consignment confirmed lost — restore no stock
                      </option>
                    </select>
                  </label>
                  <label className="workflow-checkbox">
                    <input
                      type="checkbox"
                      checked={consignmentResolved}
                      onChange={(e) => setConsignmentResolved(e.target.checked)}
                    />
                    I confirm the original consignment is resolved
                    {originalResolution === "returned_to_hq"
                      ? " and every pair was physically received back at HQ"
                      : ""}
                    .
                  </label>
                </>
              )}
              {w.replacementRequired && (
                <p className="inline-note">
                  The original shipment has been reconciled. Select another
                  branch; the previous shipment cannot resume.
                </p>
              )}
              <button
                className="button primary"
                disabled={
                  pending ||
                  !backupBranch ||
                  reason.trim().length < 3 ||
                  (w.dispatched &&
                    !w.replacementRequired &&
                    !consignmentResolved)
                }
                onClick={() =>
                  act("route_branch", {
                    branchId: backupBranch,
                    reason,
                    originalResolution,
                    consignmentResolved,
                    receivedBack:
                      consignmentResolved &&
                      originalResolution === "returned_to_hq",
                  })
                }
              >
                Request branch acceptance
              </button>
            </div>
          </details>
        )}
      {!terminal &&
        (!w.fulfilment ||
          (!!w.fulfilment.current &&
            w.fulfilment.current.state !== "requested")) &&
        (!branch || (canFulfil && !pendingHandoff)) && (
          <section className="workflow-section">
            <h4>
              <Truck size={17} />
              {branch ? "Branch delivery" : "Fulfilment"}
            </h4>
            <div className="workflow-form">
              {canFulfil &&
                ["Confirmed", "Preparing"].includes(deliveryStatus) && (
                  <>
                    <label className="field">
                      Assign driver
                      <select
                        value={driver}
                        onChange={(e) => setDriver(e.target.value)}
                      >
                        <option value="">Choose an active driver</option>
                        {accounts
                          .filter(
                            (a) =>
                              a.role === "driver" &&
                              a.status === "Active" &&
                              (a.branchId ?? null) ===
                                (w.sourceBranchId ?? null),
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.username}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      disabled={pending || !driver}
                      onClick={() => act("assign", { driverId: driver })}
                    >
                      Save driver assignment
                    </button>
                  </>
                )}
              <div className="workflow-buttons">
                {canFulfil && deliveryStatus === "Confirmed" && (
                  <button
                    className="button primary"
                    disabled={pending}
                    onClick={() => act("prepare")}
                  >
                    Start preparation
                  </button>
                )}
                {canFulfil && deliveryStatus === "Preparing" && (
                  <button
                    className="button primary"
                    disabled={pending || !w.driverId}
                    onClick={() => act("dispatch")}
                  >
                    Dispatch reserved pairs
                  </button>
                )}
                {isDriver &&
                  deliveryStatus === "Shipping" &&
                  !w.handover &&
                  !w.pickedUpAt && (
                    <DriverGroupPickup
                      viewer={viewer}
                      demo={demo}
                      refresh={refresh}
                      orderId={order.id}
                      from={deliveryOrigin}
                      fallback={
                        <div>
                          <p className="muted">
                            Confirm once you have the parcel. Your live location
                            will be shared with HQ and this order’s SME while
                            Supply Link stays open. Allow GPS when asked; you
                            can pause sharing.
                          </p>
                          <button
                            type="button"
                            className="button primary"
                            disabled={pending || !!w.issue}
                            onClick={() => act("pickup")}
                          >
                            Confirm pickup & start delivery
                          </button>
                        </div>
                      }
                    />
                  )}
                {isDriver &&
                  deliveryStatus === "Shipping" &&
                  !w.handover &&
                  !!w.pickedUpAt && (
                    <button
                      className="button primary"
                      disabled={pending}
                      onClick={() => act("handover")}
                    >
                      Report delivery handover
                    </button>
                  )}
              </div>
              {sme &&
                ["Shipping", "Complete"].includes(deliveryStatus) &&
                !w.received &&
                !w.fulfilment?.current?.received && (
                  <>
                    <label className="workflow-checkbox">
                      <input
                        type="checkbox"
                        checked={fullReceipt}
                        onChange={(e) => setFullReceipt(e.target.checked)}
                      />
                      {w.fulfilment?.current
                        ? `I received all ${w.fulfilment.current.pairs} pairs in phase ${w.fulfilment.current.number}.`
                        : "I received every ordered pair, in full."}
                    </label>
                    <button
                      className="button primary"
                      disabled={pending || !fullReceipt}
                      onClick={() => act("receive", { fullReceipt })}
                    >
                      {w.fulfilment?.current
                        ? `Confirm phase ${w.fulfilment.current.number} receipt`
                        : "Confirm full receipt"}
                    </button>
                  </>
                )}
              {deliveryStatus === "Complete" && !w.received && (
                <p className="muted">
                  Driver handover and SME receipt are required before this
                  becomes Done.
                </p>
              )}
              {w.received && !w.handover && order.status !== "Done" && (
                <p className="muted">
                  SME receipt recorded. Waiting for driver handover.
                </p>
              )}
              {isDriver &&
                !["Shipping", "On hold"].includes(deliveryStatus) && (
                  <p className="muted">
                    HQ will dispatch this order after preparation.
                  </p>
                )}
              <label className="field">
                Issue, rejection or cancellation reason
                <textarea
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe what happened and the required follow-up"
                />
              </label>
              <div className="workflow-buttons">
                {["Preparing", "Shipping", "Complete"].includes(
                  deliveryStatus,
                ) &&
                  !(sme && deliveryStatus === "Preparing") && (
                    <button
                      className="button secondary"
                      disabled={pending || reason.trim().length < 3}
                      onClick={() => act("hold", { reason })}
                    >
                      Report issue / hold
                    </button>
                  )}
                {hq && deliveryStatus === "On hold" && (
                  <button
                    className="button primary"
                    disabled={
                      pending ||
                      reason.trim().length < 3 ||
                      w.handoffPending ||
                      w.replacementRequired
                    }
                    onClick={() => act("resolve", { reason })}
                  >
                    Record resolution & resume
                  </button>
                )}
                {(hq || (sme && !w.reserved && !w.paymentVerified)) &&
                  [
                    "Draft",
                    "Awaiting verification",
                    "Confirmed",
                    "Preparing",
                  ].includes(deliveryStatus) && (
                    <button
                      className="button secondary"
                      disabled={pending || reason.trim().length < 3}
                      onClick={() => act("cancel", { reason })}
                    >
                      Cancel order
                    </button>
                  )}
              </div>
            </div>
          </section>
        )}
      {error && (
        <p className="form-error" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
    </div>
  );
}
