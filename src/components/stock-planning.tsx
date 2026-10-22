"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  CircleHelp,
  Info,
  PackagePlus,
  RefreshCw,
  X,
} from "lucide-react";
import type { Viewer, WorkspaceData } from "@/lib/domain";
import {
  nextPlanningMonth,
  type BackupPlanningRow,
  type BackupPlanningDetail,
} from "@/lib/stock-planning";
import { planningRequest } from "@/lib/stock-planning-client";
import { statusToneClass } from "@/lib/status-tone";
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
const planningUnit = (row: BackupPlanningRow) =>
  row.variant.toLowerCase().includes("piece") ? "piece" : row.unit;
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
            <option value="">All Ocean Pride Longyi styles</option>
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
                  Choose another filter, or create an active branch and Ocean
                  Pride SKU using the existing inventory workflow.
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
          setArea={setArea}
          viewer={viewer}
          demo={demo}
          close={() => {
            setSelected(null);
            trigger.current?.focus();
          }}
          updated={updated}
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
  setArea,
  viewer,
  demo,
  close,
  updated,
  refreshOverview,
}: {
  initial: BackupPlanningRow;
  area: string;
  setArea: (area: string) => void;
  viewer: Viewer;
  demo: boolean;
  close: () => void;
  updated: () => Promise<unknown>;
  refreshOverview: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [manualNumbers, setManualNumbers] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
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
    return () => {
      element?.close();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
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
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice("");
    try {
      const result = await planningRequest({
        action,
        ...values,
        key: retry.current.key,
      });
      retry.current = null;
      setNotice(result.message ?? "Planning updated.");
      noticeTimer.current = setTimeout(() => {
        setNotice("");
        noticeTimer.current = null;
      }, 4000);
      await Promise.allSettled([query.refetch(), refreshOverview(), updated()]);
      if (action === "settings") {
        setShowCriteria(false);
        setArea("refills");
      }
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
            {row.productName} · {row.variant} · {planningUnit(row)}
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
                  <span
                    className={`backup-status ${statusToneClass(manualNumbers ? "Manual" : row.source === "ai" || (row.target === null && rec.eligible) ? "AI-assisted" : "Manual")}`}
                  >
                    {manualNumbers
                      ? "Manual"
                      : row.source === "ai" ||
                          (row.target === null && rec.eligible)
                        ? "AI-assisted"
                        : "Manual"}
                  </span>
                </div>
                <form
                  className="backup-form backup-settings-form"
                  key={`${row.target}:${row.threshold}:${planningUnit(row)}:${row.source}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    const target = Number(
                        targetDraft ??
                          row.target ??
                          (rec.eligible ? rec.quantity : 0),
                      ),
                      threshold = Number(thresholdDraft ?? row.threshold ?? 0);
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
                      source: manualNumbers
                        ? "manual"
                        : row.source === "ai" ||
                            (row.target === null && rec.eligible)
                          ? "ai"
                          : "manual",
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
                      value={String(
                        targetDraft ??
                          row.target ??
                          (rec.eligible ? rec.quantity : 0),
                      )}
                      onChange={(event) => {
                        setManualNumbers(true);
                        setTargetDraft(event.target.value);
                      }}
                    />
                    <small>{planningUnit(row)}</small>
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
                      value={thresholdDraft ?? row.threshold ?? 0}
                      onChange={(event) => {
                        setManualNumbers(true);
                        setThresholdDraft(event.target.value);
                      }}
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
                      defaultValue={planningUnit(row)}
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
                  <div className="backup-settings-actions">
                    <button className="button primary" disabled={busy}>
                      Save settings
                    </button>
                    <button
                      type="button"
                      className="backup-criteria-button"
                      aria-expanded={showCriteria}
                      aria-controls="backup-criteria-popup"
                      aria-label="Show AI suggestion criteria"
                      onClick={() => setShowCriteria((value) => !value)}
                    >
                      <CircleHelp size={17} aria-hidden="true" />
                    </button>
                  </div>
                  {showCriteria && (
                    <div
                      className="backup-criteria-popover"
                      id="backup-criteria-popup"
                      role="dialog"
                      aria-label="AI suggestion criteria"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setShowCriteria(false);
                      }}
                    >
                      <div className="backup-criteria-heading">
                        <strong>AI suggestion criteria</strong>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Close AI suggestion criteria"
                          onClick={() => setShowCriteria(false)}
                        >
                          <X size={17} aria-hidden="true" />
                        </button>
                      </div>
                      <p>
                        A suggested target appears after at least three complete
                        observed months, five accepted emergency orders for this
                        branch and longyi style, and one completed backup
                        refill. Retail sales are excluded.
                      </p>
                      <p>
                        The target is the rounded-up monthly emergency-demand
                        average plus demand variation and average daily demand
                        during refill lead time. This is a planning estimate
                        from recorded history, not a trained forecast.
                      </p>
                      <small>
                        Evidence period: {rec.from} to {rec.to} (end excluded).{" "}
                        {rec.orders} accepted orders · {rec.receipts} completed
                        refills · {rec.completeMonths}/3 complete months.
                      </small>
                      {!rec.eligible && (
                        <p>
                          History does not meet the minimum yet. Set the target
                          manually.
                        </p>
                      )}
                    </div>
                  )}
                </form>
              </section>
            )}
            {area === "refills" && (
              <>
                <section className="backup-drawer-section" id="backup-refills">
                  <button
                    type="button"
                    className="backup-back-button"
                    onClick={() => setArea("settings")}
                  >
                    <ArrowLeft size={16} aria-hidden="true" /> Back to HQ
                    settings
                  </button>
                  <h3>Refill details</h3>
                  <dl className="backup-facts">
                    <div>
                      <dt>Backup stock on hand</dt>
                      <dd>
                        {row.available + row.reserved} {planningUnit(row)}
                      </dd>
                    </div>
                    <div>
                      <dt>Reserved for takeovers</dt>
                      <dd>
                        {row.reserved} {planningUnit(row)}
                      </dd>
                    </div>
                    <div>
                      <dt>Available backup</dt>
                      <dd>
                        {row.available} {planningUnit(row)}
                      </dd>
                    </div>
                    <div>
                      <dt>In transit to branch</dt>
                      <dd>
                        {row.incoming} {planningUnit(row)}
                      </dd>
                    </div>
                    <div>
                      <dt>Proposed refill</dt>
                      <dd>
                        {row.proposedRefill ?? "—"} {planningUnit(row)}
                      </dd>
                    </div>
                  </dl>
                  <p className="backup-calculation">
                    Refill = max(0, target − (backup on hand − reservations) −
                    in-transit backup). Dispatched backup stock counts as
                    incoming until the branch confirms physical receipt.
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
                        {row.proposedRefill ?? 0} {planningUnit(row)}
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
                        <span
                          className={`backup-status ${statusToneClass(t.status === "shipping" ? "In transit" : t.status)}`}
                        >
                          {t.status === "shipping" ? "In transit" : t.status}
                        </span>
                      </div>
                      <p>
                        {t.quantity} {planningUnit(row)} · {date(t.createdAt)}
                      </p>
                      {t.status === "reserved" && (
                        <form
                          className="backup-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void mutate("dispatch_refill", {
                              transferId: t.id,
                              confirmed: true,
                              reason:
                                "HQ confirmed actual backup stock dispatch",
                            });
                          }}
                        >
                          <label className="backup-check">
                            <input type="checkbox" required /> I confirm these
                            goods have physically left HQ.
                          </label>
                          <button className="button secondary" disabled={busy}>
                            Confirm dispatch
                          </button>
                        </form>
                      )}
                      {t.status === "shipping" && (
                        <p className="muted">
                          Waiting for the branch to confirm physical receipt.
                        </p>
                      )}
                      {t.receivedAt && (
                        <p>Receipt confirmed: {date(t.receivedAt)}</p>
                      )}
                    </article>
                  ))}
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
          </>
        )}
      </div>
    </dialog>
  );
}
