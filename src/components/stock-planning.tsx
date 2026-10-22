"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Info,
  PackagePlus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { Viewer, WorkspaceData } from "@/lib/domain";
import {
  nextPlanningMonth,
  type BackupPlanningRow,
  type BackupPlanningDetail,
} from "@/lib/stock-planning";
import { planningRequest } from "@/lib/stock-planning-client";
import { MonthlyPlanner } from "./stock-planning-versions";

async function readPlanning<T>(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/stock-planning?${new URLSearchParams(params)}`,
    { cache: "no-store", signal },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Unable to load stock planning.");
  return body.data;
}
const quantity = (value: number) => value.toLocaleString();
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Yangon",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";

export function StockPlanning({
  data,
  viewer,
  demo,
  updated,
  initialBranchId,
  openOrder,
}: {
  data: WorkspaceData;
  viewer: Viewer;
  demo: boolean;
  updated: () => Promise<unknown>;
  initialBranchId?: string;
  openOrder?: (id: string) => Promise<void> | void;
}) {
  const [branch, setBranch] = useState(initialBranchId ?? "");
  const [product, setProduct] = useState("");
  const [selected, setSelected] = useState<BackupPlanningRow | null>(null);
  const [area, setArea] = useState("settings");
  const trigger = useRef<HTMLElement | null>(null);
  const query = useQuery({
    queryKey: ["backup-overview", viewer.id, demo],
    queryFn: ({ signal }) =>
      readPlanning<{ rows: BackupPlanningRow[] }>({ view: "overview" }, signal),
    retry: false,
    refetchInterval: 30000,
  });
  const rows = (query.data?.rows ?? []).filter(
    (r) =>
      (!branch || r.branchId === branch) &&
      (!product || r.productId === product),
  );
  const lows = rows.filter((r) => r.low);
  const products = [
    ...new Map((query.data?.rows ?? []).map((r) => [r.productId, r])).values(),
  ];
  const branches = [
    ...new Map((query.data?.rows ?? []).map((r) => [r.branchId, r])).values(),
  ];
  function manage(row: BackupPlanningRow, section = "settings") {
    trigger.current = document.activeElement as HTMLElement;
    setArea(section);
    setSelected(row);
  }
  if (viewer.role !== "hq")
    return <p role="alert">Stock planning is restricted to HQ.</p>;
  return (
    <div className="stock-planning backup-workspace">
      <div className="backup-purpose">
        <Info size={18} aria-hidden="true" />
        <span>
          Retail stock and wholesale backup are tracked separately. Emergency
          deliveries use backup only.
        </span>
      </div>
      <section className="backup-filters" aria-label="Stock planning filters">
        <label className="field">
          Product / SKU
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All STT variants</option>
            {products.map((r) => (
              <option value={r.productId} key={r.productId}>
                {r.productName} · {r.variant}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Branches
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((r) => (
              <option value={r.branchId} key={r.branchId}>
                {r.branchName}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Quantities use each row’s configured stock unit.
        </p>
        <button
          className="icon-button"
          aria-label="Refresh stock planning"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={18} />
        </button>
      </section>
      {query.isPending ? (
        <div className="panel info-pad" role="status">
          Loading branch backup stock…
        </div>
      ) : query.isError ? (
        <div className="panel info-pad" role="alert">
          <p>Stock planning could not refresh. {query.error.message}</p>
          <button
            className="button secondary"
            onClick={() => void query.refetch()}
          >
            Retry loading
          </button>
        </div>
      ) : (
        <>
          <section
            className={`backup-alerts ${lows.length ? "has-alerts" : ""}`}
            aria-label="Low backup alerts"
          >
            <div className="backup-section-heading">
              <h2>
                <AlertTriangle size={18} aria-hidden="true" />{" "}
                {lows.length
                  ? `${lows.length} low backup ${lows.length === 1 ? "alert" : "alerts"}`
                  : "No low backup alerts"}
              </h2>
              <span className="muted">HQ action list</span>
            </div>
            {lows.slice(0, 3).map((r) => (
              <div
                className="backup-alert-row"
                key={`${r.branchId}:${r.productId}`}
              >
                <p>
                  <strong>{r.branchName}</strong> · {r.variant}
                  <br />
                  <span>
                    {quantity(r.available)} {r.unit} available · alert at{" "}
                    {r.threshold} · target {r.target}
                  </span>
                </p>
                <button
                  className="button secondary"
                  onClick={() => manage(r, "refills")}
                >
                  {r.openRefills ? "Review open refill" : "Create refill"}
                </button>
              </div>
            ))}
            {lows.length > 3 && (
              <p className="muted">
                {lows.length - 3} more low-stock rows are marked in the table
                below.
              </p>
            )}
            {!lows.length && (
              <p className="muted">
                Configured alerts update automatically as available backup stock
                changes.
              </p>
            )}
          </section>
          <section
            className="panel backup-stock-panel"
            aria-label="Branch backup plans"
          >
            <div
              className="backup-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Branch backup stock table"
            >
              <table className="backup-overview-table">
                <caption className="sr-only">
                  Retail reference and dedicated wholesale backup by branch and
                  SKU
                </caption>
                <thead>
                  <tr>
                    <th>Branch / SKU</th>
                    <th className="numeric">Retail stock</th>
                    <th className="numeric">Backup available</th>
                    <th className="numeric">Target</th>
                    <th>Plan source</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.branchId}:${r.productId}`}>
                      <th scope="row">
                        <strong>{r.branchName}</strong>
                        <small>
                          {r.variant} · {r.unit}
                        </small>
                      </th>
                      <td className="numeric muted">
                        {quantity(r.retail)}
                        <small>reference only</small>
                      </td>
                      <td className="numeric">
                        <strong>{quantity(r.available)}</strong>
                        {r.reserved > 0 && <small>{r.reserved} reserved</small>}
                      </td>
                      <td className="numeric">
                        {r.target === null ? "—" : quantity(r.target)}
                      </td>
                      <td>{r.source === "ai" ? "AI-assisted" : "Manual"}</td>
                      <td>
                        <span
                          className={`backup-status ${r.target === null ? "unset" : r.low ? "low" : "healthy"}`}
                        >
                          {r.target === null
                            ? "Needs setup"
                            : r.low
                              ? "Low"
                              : "Healthy"}
                        </span>
                        {r.openRefills > 0 && <small>Refill open</small>}
                      </td>
                      <td>
                        <button
                          className="backup-manage"
                          aria-label={`Manage ${r.branchName} ${r.variant}`}
                          onClick={() => manage(r)}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="info-pad">
                <h2>No matching branch stock</h2>
                <p>
                  Choose another filter, or create an active branch and STT SKU
                  using the existing inventory workflow.
                </p>
              </div>
            )}
            <p className="backup-table-note">
              Retail is shown for reference only. Reserved backup and stock in
              transit are not available for another takeover.
            </p>
          </section>
        </>
      )}
      {selected && (
        <BackupDrawer
          key={`${selected.branchId}:${selected.productId}`}
          initial={selected}
          area={area}
          viewer={viewer}
          demo={demo}
          close={() => {
            setSelected(null);
            trigger.current?.focus();
          }}
          updated={updated}
          openOrder={openOrder}
          refreshOverview={async () => {
            await query.refetch();
          }}
        />
      )}
    </div>
  );
}

function BackupDrawer({
  initial,
  area,
  viewer,
  demo,
  close,
  updated,
  refreshOverview,
  openOrder,
}: {
  initial: BackupPlanningRow;
  area: string;
  viewer: Viewer;
  demo: boolean;
  close: () => void;
  updated: () => Promise<unknown>;
  refreshOverview: () => Promise<void>;
  openOrder?: (id: string) => Promise<void> | void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [takingOver, setTakingOver] = useState(false),
    [orderId, setOrderId] = useState("");
  const [advanced, setAdvanced] = useState(false),
    [month, setMonth] = useState(nextPlanningMonth().slice(0, 7));
  const query = useQuery({
    queryKey: [
      "backup-detail",
      viewer.id,
      demo,
      initial.branchId,
      initial.productId,
    ],
    queryFn: ({ signal }) =>
      readPlanning<BackupPlanningDetail>(
        {
          view: "detail",
          branchId: initial.branchId,
          productId: initial.productId,
        },
        signal,
      ),
    retry: false,
    refetchInterval: 15000,
  });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (query.data && area === "refills")
      document
        .getElementById("backup-refills")
        ?.scrollIntoView?.({ block: "start" });
  }, [!!query.data, area]);
  const detail = query.data,
    row = detail?.row ?? initial,
    rec = row.recommendation;
  async function mutate(action: string, payload: Record<string, unknown>) {
    if (busy) return false;
    const values = {
      branchId: row.branchId,
      productId: row.productId,
      ...payload,
    };
    const fingerprint = JSON.stringify([action, values]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await planningRequest({
        action,
        ...values,
        key: retry.current.key,
      });
      retry.current = null;
      setNotice(result.message ?? "Planning updated.");
      await Promise.allSettled([query.refetch(), refreshOverview(), updated()]);
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Connection interrupted. Retry the same details.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const selectedOrder = detail?.orders.find((o) => o.id === orderId);
  return (
    <dialog
      className="planning-drawer"
      ref={dialog}
      aria-labelledby="backup-plan-title"
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="backup-drawer-heading">
        <div>
          <span className="planning-eyebrow">Wholesale reserve · HQ</span>
          <h2 id="backup-plan-title">
            {row.branchName}{" "}
            {area === "refills" ? "backup refill" : "backup plan"}
          </h2>
          <p>
            {row.productName} · {row.variant} · {row.unit}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={close}
          disabled={busy}
          aria-label="Close backup plan"
        >
          <X size={21} />
        </button>
      </div>
      <div className="backup-drawer-body">
        {notice && (
          <p className="planning-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {query.isPending ? (
          <p role="status">Loading backup plan…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Could not refresh this plan. {query.error.message}</p>
            <button
              className="button secondary"
              onClick={() => void query.refetch()}
            >
              Retry details
            </button>
          </div>
        ) : (
          <>
            {area !== "refills" && (
              <section className="backup-drawer-section" id="backup-settings">
                <div className="backup-section-heading">
                  <h3>HQ settings</h3>
                  <span className="backup-status unset">
                    {row.source === "ai" ? "AI-assisted" : "Manual"}
                  </span>
                </div>
                <form
                  className="backup-form"
                  key={`${row.target}:${row.threshold}:${row.unit}:${row.source}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    const target = Number(values.get("target")),
                      threshold = Number(values.get("threshold"));
                    if (threshold > target) {
                      setError(
                        "Alert threshold must be no greater than the target.",
                      );
                      return;
                    }
                    void mutate("settings", {
                      target,
                      threshold,
                      unit: values.get("unit"),
                      source: "manual",
                      reason: values.get("reason"),
                    });
                  }}
                >
                  <label className="field">
                    Target backup
                    <input
                      name="target"
                      type="number"
                      min={0}
                      max={1000000}
                      step={1}
                      required
                      defaultValue={row.target ?? 0}
                    />
                    <small>{row.unit}</small>
                  </label>
                  <label className="field">
                    Low-stock alert threshold
                    <input
                      name="threshold"
                      type="number"
                      min={0}
                      max={1000000}
                      step={1}
                      required
                      defaultValue={row.threshold ?? 0}
                    />
                    <small>
                      Alert when available stock is at or below this quantity.
                    </small>
                  </label>
                  <label className="field">
                    Stock unit
                    <input
                      name="unit"
                      pattern="[a-zA-Z][a-zA-Z ]{0,23}"
                      maxLength={24}
                      required
                      defaultValue={row.unit}
                    />
                    <small>One inventory count equals one selected unit.</small>
                  </label>
                  <label className="field">
                    Reason for settings
                    <input
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                      placeholder="e.g. Initial emergency reserve approved by HQ"
                    />
                  </label>
                  <p className="muted">
                    Settings do not move retail stock or change physical stock
                    balances.
                  </p>
                  <button className="button primary" disabled={busy}>
                    Save settings
                  </button>
                </form>
              </section>
            )}
            <section
              className="backup-drawer-section"
              aria-labelledby="backup-ai-title"
            >
              <div className="backup-section-heading">
                <h3 id="backup-ai-title">
                  <Sparkles size={18} /> AI recommendation
                </h3>
                <span
                  className={`backup-status ${rec.eligible ? "healthy" : "unset"}`}
                >
                  {rec.eligible ? "Evidence available" : "Insufficient history"}
                </span>
              </div>
              {!rec.eligible ? (
                <p className="backup-purpose">
                  Insufficient history — continue with the HQ manual plan.
                </p>
              ) : (
                <>
                  <p className="backup-suggestion">
                    <strong>
                      {quantity(rec.quantity!)} {row.unit}
                    </strong>
                    <span>Suggested backup target</span>
                  </p>
                  <form
                    className="backup-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const values = new FormData(e.currentTarget);
                      void mutate("settings", {
                        target: rec.quantity,
                        threshold: row.threshold ?? 0,
                        unit: row.unit,
                        source: "ai",
                        reason: values.get("reason"),
                      });
                    }}
                  >
                    <label className="field">
                      Reason for applying recommendation
                      <input
                        name="reason"
                        minLength={3}
                        maxLength={500}
                        required
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy || (row.threshold ?? 0) > rec.quantity!}
                    >
                      Apply recommended target
                    </button>
                    {(row.threshold ?? 0) > rec.quantity! && (
                      <p>
                        Lower the alert threshold in HQ settings before applying
                        this target.
                      </p>
                    )}
                  </form>
                </>
              )}
              <p className="muted">
                Evidence period: {rec.from} to {rec.to} (end excluded).
              </p>
              <dl className="backup-facts">
                <div>
                  <dt>Complete observed months</dt>
                  <dd>{rec.completeMonths} / 3</dd>
                </div>
                <div>
                  <dt>Accepted emergency orders</dt>
                  <dd>{rec.orders} / 5 minimum</dd>
                </div>
                <div>
                  <dt>Emergency demand</dt>
                  <dd>
                    {rec.units} {row.unit}
                  </dd>
                </div>
                <div>
                  <dt>Completed backup refills</dt>
                  <dd>{rec.receipts} / 1 minimum</dd>
                </div>
                {rec.eligible && (
                  <>
                    <div>
                      <dt>Monthly demand variation</dt>
                      <dd>
                        {rec.monthlyVariation} {row.unit}
                      </dd>
                    </div>
                    <div>
                      <dt>Average refill lead time</dt>
                      <dd>{rec.leadDays} days</dd>
                    </div>
                  </>
                )}
              </dl>
              <details className="backup-limitations">
                <summary>Method and limitations</summary>
                <p>
                  Minimum: three complete observed months, five accepted
                  emergency orders for this branch/SKU, and one completed backup
                  refill in the supporting period. Retail sales do not qualify.
                </p>
                <p>
                  Target = rounded-up monthly emergency average + monthly
                  standard deviation + average daily emergency demand × refill
                  lead time. This is a statistical planning estimate, not a
                  trained forecast or a confidence score. Cancelled orders and
                  unaccepted demand are excluded; lost demand, returns, seasonal
                  changes and unrecorded events can limit the estimate.
                </p>
              </details>
            </section>
            <section className="backup-drawer-section" id="backup-refills">
              <h3>Refill details</h3>
              <dl className="backup-facts">
                <div>
                  <dt>Backup stock on hand</dt>
                  <dd>
                    {row.available + row.reserved} {row.unit}
                  </dd>
                </div>
                <div>
                  <dt>Reserved for takeovers</dt>
                  <dd>
                    {row.reserved} {row.unit}
                  </dd>
                </div>
                <div>
                  <dt>Available backup</dt>
                  <dd>
                    {row.available} {row.unit}
                  </dd>
                </div>
                <div>
                  <dt>Confirmed incoming</dt>
                  <dd>
                    {row.incoming} {row.unit}
                  </dd>
                </div>
                <div>
                  <dt>Proposed refill</dt>
                  <dd>
                    {row.proposedRefill ?? "—"} {row.unit}
                  </dd>
                </div>
              </dl>
              <p className="backup-calculation">
                Refill = max(0, target − (backup on hand − reservations) −
                confirmed incoming). Only dispatched backup transfers with a
                current, confirmed arrival date offset the proposal.
              </p>
              {row.openRefills > 0 ? (
                <p className="backup-purpose">
                  {row.openRefills} open backup{" "}
                  {row.openRefills === 1 ? "refill" : "refills"}. Review the
                  existing transfer before creating another.
                </p>
              ) : (
                <form
                  className="backup-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    void mutate("refill", { reason: form.get("reason") });
                  }}
                >
                  <label className="field">
                    Refill reason
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      placeholder="e.g. Restore the emergency backup target"
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy || !row.proposedRefill}
                  >
                    <PackagePlus size={17} /> Create refill ·{" "}
                    {row.proposedRefill ?? 0} {row.unit}
                  </button>
                </form>
              )}
              <p className="muted">
                In-transit stock becomes available only after the branch
                confirms physical receipt.
              </p>
              {!detail?.transfers.length && (
                <p className="muted">No backup refill transfers yet.</p>
              )}
              {detail?.transfers.map((t) => (
                <article className="backup-history-card" key={t.id}>
                  <div className="backup-section-heading">
                    <strong>{t.reference}</strong>
                    <span className="backup-status unset">
                      {t.status === "shipping" ? "In transit" : t.status}
                    </span>
                  </div>
                  <p>
                    {t.quantity} {row.unit} · {date(t.createdAt)}
                  </p>
                  {t.status === "reserved" && (
                    <form
                      className="backup-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate("dispatch_refill", {
                          transferId: t.id,
                          confirmed: true,
                          reason: "HQ confirmed actual backup stock dispatch",
                        });
                      }}
                    >
                      <label className="backup-check">
                        <input type="checkbox" required /> I confirm these goods
                        have physically left HQ.
                      </label>
                      <button className="button secondary" disabled={busy}>
                        Confirm dispatch
                      </button>
                    </form>
                  )}
                  {t.status === "shipping" && (
                    <form
                      className="backup-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void mutate("arrival", {
                          transferId: t.id,
                          due: f.get("due"),
                          reason: "HQ confirmed backup refill arrival date",
                        });
                      }}
                    >
                      <label className="field">
                        Confirmed arrival date
                        <input
                          name="due"
                          type="date"
                          required
                          defaultValue={t.due ?? ""}
                        />
                      </label>
                      <button className="button secondary" disabled={busy}>
                        Confirm arrival date
                      </button>
                    </form>
                  )}
                  {t.receivedAt && (
                    <p>Receipt confirmed: {date(t.receivedAt)}</p>
                  )}
                </article>
              ))}
            </section>
            <section className="backup-drawer-section">
              <h3>Emergency fulfillment</h3>
              <p>
                Use backup only when HQ cannot meet the wholesale delivery
                deadline. The branch must accept the request before stock is
                reserved.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setTakingOver(!takingOver)}
              >
                Record takeover
              </button>
              {takingOver &&
                (!detail?.orders.length ? (
                  <p className="backup-purpose">
                    No eligible paid, reserved HQ order contains this SKU.
                    Prepare the original wholesale order using the existing
                    order workflow first.
                  </p>
                ) : (
                  <form
                    className="backup-form backup-takeover-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const success = await mutate("takeover", {
                        orderId,
                        deadline: new Date(
                          `${String(f.get("deadline"))}+06:30`,
                        ).toISOString(),
                        reason: f.get("reason"),
                        ...(selectedOrder?.dispatched
                          ? {
                              originalResolution: f.get("resolution"),
                              consignmentResolved: true,
                              receivedBack: f.get("receivedBack") === "on",
                            }
                          : {}),
                      });
                      if (success) setTakingOver(false);
                    }}
                  >
                    <label className="field">
                      Original wholesale order
                      <select
                        required
                        value={orderId}
                        onChange={(e) => setOrderId(e.target.value)}
                      >
                        <option value="">Choose an order</option>
                        {detail.orders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.reference} · {o.quantity} {row.unit} of this SKU
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedOrder && (
                      <p className="backup-purpose">
                        The branch takes over the entire order:{" "}
                        {selectedOrder.lines
                          .map((l) => `${l.variant}: ${l.quantity}`)
                          .join("; ")}
                        . Every SKU must have sufficient backup at acceptance.
                      </p>
                    )}
                    <label className="field">
                      Original delivery deadline (Yangon local time)
                      <input name="deadline" type="datetime-local" required />
                    </label>
                    <label className="field">
                      Takeover reason / HQ delivery problem
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Explain why HQ cannot meet the deadline."
                      />
                    </label>
                    {selectedOrder?.dispatched && (
                      <>
                        <label className="field">
                          Original HQ consignment resolution
                          <select name="resolution" required>
                            <option value="">Choose a resolution</option>
                            <option value="returned_to_hq">
                              Returned to HQ
                            </option>
                            <option value="lost">Confirmed lost</option>
                          </select>
                        </label>
                        <label className="backup-check">
                          <input name="receivedBack" type="checkbox" /> If
                          returned: all original goods were physically received
                          back at HQ.
                        </label>
                        <label className="backup-check">
                          <input type="checkbox" required /> I confirm the
                          original consignment is reconciled and cannot also
                          fulfill this order.
                        </label>
                      </>
                    )}
                    <button className="button primary" disabled={busy}>
                      Request branch takeover
                    </button>
                  </form>
                ))}
            </section>
            <section className="backup-drawer-section">
              <h3>Takeover history</h3>
              {!detail?.takeovers.length && (
                <p className="muted">
                  No emergency takeovers recorded for this branch/SKU.
                </p>
              )}
              {detail?.takeovers.map((t) => (
                <article className="backup-history-card" key={t.id}>
                  <div className="backup-section-heading">
                    <strong>{t.reference}</strong>
                    <span className="backup-status unset">{t.status}</span>
                  </div>
                  <p>
                    {t.quantity} {t.unit} · {t.actor} · {date(t.at)}
                  </p>
                  <p>{t.reason}</p>
                  {openOrder && (
                    <button
                      className="backup-manage"
                      disabled={busy}
                      onClick={() => {
                        close();
                        void openOrder(t.orderId);
                      }}
                    >
                      Manage original wholesale order
                    </button>
                  )}
                  <p className="muted">
                    Deadline: {date(t.deadline)}
                    <br />
                    Fulfilled:{" "}
                    {t.fulfilledAt
                      ? date(t.fulfilledAt)
                      : "Awaiting confirmed receipt"}
                  </p>
                  <details>
                    <summary>Audit trail</summary>
                    <p>Original consignment: {t.resolution}</p>
                    {t.responseReason && (
                      <p>Branch / cancellation reason: {t.responseReason}</p>
                    )}
                    {t.events.map((event, i) => (
                      <p key={i}>
                        {event.action} · {event.actor} · {date(event.at)}
                        {event.reason && ` · ${event.reason}`}
                      </p>
                    ))}
                  </details>
                  {t.status === "pending" && (
                    <form
                      className="backup-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void mutate("cancel_takeover", {
                          orderId: t.orderId,
                          handoffId: t.id,
                          reason: f.get("reason"),
                        });
                      }}
                    >
                      <label className="field">
                        Cancellation reason
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                        />
                      </label>
                      <button className="button secondary" disabled={busy}>
                        Cancel takeover request
                      </button>
                    </form>
                  )}
                </article>
              ))}
              <p className="muted">
                Accepted takeovers reserve backup; dispatch deducts it once.
                Cancellations before dispatch restore the reservation through
                the existing order workflow. Dispatched stock requires
                reconciliation, not an automatic stock reversal.
              </p>
            </section>
            <section className="backup-drawer-section">
              <button
                className="backup-manage"
                onClick={() => setAdvanced(!advanced)}
                aria-expanded={advanced}
              >
                Advanced monthly versions and Groq explanations
              </button>
              {advanced && (
                <div className="backup-advanced">
                  <label className="field">
                    Planning month
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                  </label>
                  {/^20\d\d-(0[1-9]|1[0-2])$/.test(month) && (
                    <MonthlyPlanner
                      branchId={row.branchId}
                      month={`${month}-01`}
                      viewer={viewer}
                      demo={demo}
                      updated={async () => {
                        await Promise.all([
                          refreshOverview(),
                          query.refetch(),
                          updated(),
                        ]);
                      }}
                    />
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}
