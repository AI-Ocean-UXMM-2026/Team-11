"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Truck,
  Upload,
} from "lucide-react";
import { workflowAction, refreshWorkspace } from "@/app/workflow-actions";
import {
  money,
  total,
  type Order,
  type Viewer,
  type Account,
  type Branch,
  type WorkspaceData,
} from "@/lib/domain";

export function OrderWorkflow({
  order,
  viewer,
  accounts,
  branches,
  updated,
}: {
  order: Order;
  viewer: Viewer;
  accounts: Account[];
  branches: Branch[];
  updated: (data: WorkspaceData, message?: string) => void;
}) {
  const w = order.workflow;
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
  const terminal = ["Done", "Cancelled"].includes(order.status);
  function act(action: string, payload: Record<string, unknown> = {}) {
    const body = { orderId: order.id, ...payload };
    const fingerprint = JSON.stringify([action, body]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const key = retry.current.key;
    setError("");
    start(async () => {
      try {
        const result = await workflowAction(action, body, key);
        if (result.error) {
          setError(result.error);
          return;
        }
        retry.current = null;
        if (result.data) updated(result.data, result.result?.message);
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
        updated(result.data, result.result?.message);
        form.reset();
      } catch {
        setError(
          "Upload interrupted. Keep your details and retry the submission.",
        );
      }
    });
  }
  return (
    <div className="modal-form workflow-detail" aria-busy={pending}>
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">STT WHOLESALE</span>
          <h3>{order.business}</h3>
          <p className="muted">{order.location}</p>
        </div>
        <span className="workflow-status">{order.status}</span>
      </div>
      <button
        type="button"
        className="text-link workflow-refresh"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshWorkspace();
            if (r.data) updated(r.data);
            else setError(r.error ?? "Refresh failed.");
          })
        }
      >
        <RefreshCw size={14} />
        Refresh status
      </button>
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
      <div className="workflow-contact">
        <Truck size={18} />
        <div>
          <strong>{w.receiver}</strong>
          <p>
            {w.phone} · {order.location}
          </p>
          {w.notes && <p>{w.notes}</p>}
          <small>Driver: {w.driverName ?? "Awaiting assignment"}</small>
        </div>
      </div>
      {privateFinance && (
        <div className="workflow-checks">
          {[
            [w.paymentVerified, "Payment verified"],
            [w.reserved, "Stock reserved"],
            [w.hqComplete, "HQ complete"],
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
      {privateFinance && (
        <section className="workflow-section">
          <h4>
            <ShieldCheck size={17} />
            Payment evidence
          </h4>
          <p className="payment-instructions">{w.instructions}</p>
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
            ["Draft", "Awaiting verification"].includes(order.status) && (
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
            order.status === "Awaiting verification" &&
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
          {hq && w.paymentVerified && !w.reserved && !terminal && (
            <button
              className="button primary"
              disabled={pending}
              onClick={() => act("confirm")}
            >
              Retry stock reservation
            </button>
          )}
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
                Accepting reserves every ordered pair from your branch. Assign
                one of your branch drivers after acceptance.
              </p>
              <button
                className="button primary"
                disabled={pending}
                onClick={() =>
                  act("handoff_accept", { handoffId: pendingHandoff.id })
                }
              >
                Accept & reserve branch stock
              </button>
              <label className="field">
                Reason if declining
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
                  act("handoff_decline", {
                    handoffId: pendingHandoff.id,
                    reason,
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
        !terminal &&
        !w.handoffPending &&
        w.paymentVerified &&
        w.reserved &&
        !w.received &&
        !w.hqComplete &&
        ["Confirmed", "Preparing", "On hold"].includes(order.status) && (
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
      {!terminal && (
        <section className="workflow-section">
          <h4>
            <Truck size={17} />
            Fulfilment
          </h4>
          <div className="workflow-form">
            {canFulfil && ["Confirmed", "Preparing"].includes(order.status) && (
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
                          (a.branchId ?? null) === (w.sourceBranchId ?? null),
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
              {canFulfil && order.status === "Confirmed" && (
                <button
                  className="button primary"
                  disabled={pending}
                  onClick={() => act("prepare")}
                >
                  Start preparation
                </button>
              )}
              {canFulfil && order.status === "Preparing" && (
                <button
                  className="button primary"
                  disabled={pending || !w.driverId}
                  onClick={() => act("dispatch")}
                >
                  Dispatch reserved pairs
                </button>
              )}
              {isDriver && order.status === "Shipping" && !w.handover && (
                <button
                  className="button primary"
                  disabled={pending}
                  onClick={() => act("handover")}
                >
                  Report delivery handover
                </button>
              )}
              {hq && order.status === "Shipping" && (
                <button
                  className="button primary"
                  disabled={pending || !w.handover}
                  onClick={() => act("complete")}
                >
                  Confirm HQ completion
                </button>
              )}
            </div>
            {sme &&
              ["Shipping", "Complete"].includes(order.status) &&
              !w.received && (
                <>
                  <label className="workflow-checkbox">
                    <input
                      type="checkbox"
                      checked={fullReceipt}
                      onChange={(e) => setFullReceipt(e.target.checked)}
                    />
                    I received every ordered pair, in full.
                  </label>
                  <button
                    className="button primary"
                    disabled={pending || !fullReceipt}
                    onClick={() => act("receive", { fullReceipt })}
                  >
                    Confirm full receipt
                  </button>
                </>
              )}
            {order.status === "Complete" && !w.received && (
              <p className="muted">
                HQ is complete. The SME must confirm full receipt before this
                becomes Done.
              </p>
            )}
            {w.received && !w.hqComplete && (
              <p className="muted">
                SME receipt recorded. Waiting for HQ completion.
              </p>
            )}
            {isDriver && !["Shipping", "On hold"].includes(order.status) && (
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
              {["Preparing", "Shipping", "Complete"].includes(order.status) &&
                !(sme && order.status === "Preparing") && (
                  <button
                    className="button secondary"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() => act("hold", { reason })}
                  >
                    Report issue / hold
                  </button>
                )}
              {hq && order.status === "On hold" && (
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
                ].includes(order.status) && (
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
      <details className="workflow-section" open>
        <summary>Order activity · {w.events.length} events</summary>
        <ol className="workflow-timeline">
          {w.events.map((e, i) => (
            <li key={i}>
              <strong>{e.action.replaceAll("_", " ")}</strong>
              <small>
                {e.actor} ·{" "}
                {new Date(e.at).toLocaleString("en-GB", {
                  timeZone: "Asia/Yangon",
                })}{" "}
                Yangon
              </small>
              {e.reason && <p>{e.reason}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
