"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Sparkles, ShieldCheck, Package, RefreshCw } from "lucide-react";
import { nextPlanningMonth, type PlanningSnapshot } from "@/lib/stock-planning";
import { businessDate, type Viewer, type WorkspaceData } from "@/lib/domain";
import { planningRequest } from "@/lib/stock-planning-client";

export function MonthlyPlanner({
  branchId,
  month,
  viewer,
  demo,
  updated,
}: {
  branchId: string;
  month: string;
  viewer: Viewer;
  demo: boolean;
  updated: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const query = useQuery({
    queryKey: ["stock-planning", viewer.id, demo, branchId, month],
    queryFn: async ({
      signal,
    }): Promise<{
      data: PlanningSnapshot;
      ai: { configured: boolean; model: string };
    }> => {
      const response = await fetch(
        `/api/stock-planning?${new URLSearchParams({ branchId, month })}`,
        { cache: "no-store", signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to load stock planning.");
      return result;
    },
    retry: false,
    refetchInterval: false,
    staleTime: 10000,
  });
  const snapshot = query.data?.data;
  const latest = snapshot?.plans[0];
  const plan = snapshot?.plans.find((p) => p.id === selectedId) ?? latest;
  const saved = latest?.rows;
  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    explain = false,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = JSON.stringify([action, payload]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await planningRequest({
        action,
        ...payload,
        key: retry.current.key,
      });
      retry.current = null;
      if (action === "generate") {
        setSelectedId(result.id);
        setNotice("New version saved. Review all targets before approving.");
        await query.refetch();
        if (explain) {
          try {
            await planningRequest({
              action: "explain",
              planId: result.id,
              regenerate: false,
            });
          } catch {
            setNotice(
              "Plan saved. AI explanation is unavailable; calculation and review remain available.",
            );
          }
        }
      } else
        setNotice(
          result.message ??
            "Plan approved. Existing allocations and physical stock are preserved. Refill transfers remain separate.",
        );
      await query.refetch();
      if (action === "approve") await updated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Connection interrupted. Retry with the same details.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function explain(regenerate: boolean) {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      await planningRequest({ action: "explain", planId: plan.id, regenerate });
      await query.refetch();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "AI explanation unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending)
    return (
      <section className="panel info-pad" role="status">
        Loading planning records…
      </section>
    );
  if (!snapshot)
    return (
      <section className="panel info-pad">
        <p role="alert">{query.error?.message}</p>
        <button
          className="button secondary"
          onClick={() => void query.refetch()}
        >
          Retry loading
        </button>
      </section>
    );
  const rows = plan?.rows ?? snapshot.current;
  const unresolved = rows.some((r) => r.target === null);
  const total = (key: "target" | "carryover" | "incoming" | "refill") =>
    rows.reduce((sum, r) => sum + (r[key] ?? 0), 0);
  const today = businessDate(new Date().toISOString());
  const monthStart = new Date(`${month}T00:00:00Z`);
  monthStart.setUTCDate(0);
  const canFinalize = today >= monthStart.toISOString().slice(0, 10);
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="planning-notice" role="status">
          {notice}
        </p>
      )}
      {query.isError && (
        <p className="form-error" role="alert">
          Refresh failed. Displayed records may be outdated.{" "}
          {query.error.message}
        </p>
      )}
      <div className="planning-stats">
        {[
          ["Monthly target", total("target")],
          ["Backup carryover", total("carryover")],
          ["Qualifying incoming", total("incoming")],
          ["Additional refill", total("refill")],
        ].map(([label, value]) => (
          <section className="stat-card" key={label}>
            <span className="muted">{label}</span>
            <strong>
              {Number(value).toLocaleString()} <small>pairs</small>
            </strong>
            {unresolved &&
              (label === "Monthly target" || label === "Additional refill") && (
                <small>Partial total · manual targets needed</small>
              )}
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Review reserve quantities</h2>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={16} /> Refresh inputs
          </button>
        </div>
        <p className="info-pad planning-context">
          History: {snapshot.historyFrom} to {snapshot.historyTo} (exclusive).
          Reliable stock observation began{" "}
          {businessDate(snapshot.coverageSince)}. No sales during a stockout
          does not establish zero demand. Customer returns are not yet captured.
        </p>
        <form
          key={`${latest?.id ?? "initial"}:${latest?.status ?? "draft"}`}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void mutate(
              "generate",
              {
                branchId,
                month,
                buffer: Number(form.get("buffer")),
                minMonths: Number(form.get("minMonths")),
                minOrders: Number(form.get("minOrders")),
                overrides: snapshot.current.map((r) => ({
                  productId: r.productId,
                  target:
                    String(form.get(`target-${r.productId}`) ?? "").trim() ===
                    ""
                      ? null
                      : Number(form.get(`target-${r.productId}`)),
                  retailMove: Number(form.get(`move-${r.productId}`) || 0),
                  reason: String(form.get(`reason-${r.productId}`) ?? ""),
                })),
              },
              query.data?.ai.configured,
            );
          }}
        >
          <div className="planning-controls">
            <label className="field">
              Safety buffer (%)
              <input
                name="buffer"
                type="number"
                min={0}
                max={100}
                required
                defaultValue={latest?.buffer ?? 20}
              />
            </label>
            <input name="minMonths" type="hidden" value={3} />
            <input name="minOrders" type="hidden" value={5} />
            <p className="muted">
              Suggestions require three complete observed months, five accepted
              emergency orders and one completed backup refill. The optional
              safety buffer is applied to the evidence-based target.
            </p>
          </div>
          <div className="table-scroll">
            <table className="planning-table">
              <caption className="sr-only">
                Current planning inputs and target overrides by shoe variant
              </caption>
              <thead>
                <tr>
                  <th>Size / color</th>
                  <th>
                    Backup demand
                    <br />3 months
                  </th>
                  <th>Retail context</th>
                  <th>Stock now</th>
                  <th>Target override</th>
                  <th>Retail → backup</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.current.map((r) => {
                  const previous = saved?.find(
                    (s) => s.productId === r.productId,
                  );
                  return (
                    <tr key={r.productId}>
                      <td>
                        <strong>{r.variant}</strong>
                        <small>
                          {r.completeMonths} complete months · {r.backupOrders}{" "}
                          distinct orders
                        </small>
                        <span
                          className={`planning-quality ${r.baseline === null ? "limited" : ""}`}
                        >
                          {r.baseline === null
                            ? "Insufficient history"
                            : `Baseline: ${r.baseline} pairs`}
                        </span>
                      </td>
                      <td>
                        {r.backupUnits} pairs
                        <small>
                          Accepted / stock-shortage demand · counted once
                        </small>
                      </td>
                      <td>
                        {r.retailUnits} sold
                        <small>{r.stockoutDays} recorded stockout days</small>
                        <small>
                          {r.refillLeadDays === null
                            ? "No recorded refill lead time"
                            : `${r.refillLeadDays} days average dispatch → receipt`}
                        </small>
                      </td>
                      <td>
                        {r.carryover} backup
                        <small>
                          {r.retailAvailable} retail available · {r.allocated}{" "}
                          allocated
                        </small>
                        <small>{r.incoming} qualifying incoming</small>
                      </td>
                      <td>
                        <input
                          aria-label={`${r.variant} target override`}
                          name={`target-${r.productId}`}
                          type="number"
                          min={0}
                          max={1000000}
                          step={1}
                          placeholder={
                            r.baseline === null
                              ? "Manual target"
                              : String(r.baseline)
                          }
                          defaultValue={
                            previous?.manual
                              ? (previous.target ?? "")
                              : r.baseline === null
                                ? (r.configuredTarget ?? "")
                                : ""
                          }
                        />
                        <small>
                          {r.baseline === null && r.configuredTarget != null
                            ? "HQ configured starting target"
                            : "Blank uses baseline"}
                        </small>
                      </td>
                      <td>
                        <input
                          aria-label={`${r.variant} approved retail movement`}
                          name={`move-${r.productId}`}
                          type="number"
                          min={0}
                          max={r.retailAvailable}
                          step={1}
                          defaultValue={
                            latest?.status === "draft"
                              ? (previous?.retailMove ?? 0)
                              : 0
                          }
                        />
                        <small>Applied only on approval</small>
                      </td>
                      <td>
                        <input
                          aria-label={`${r.variant} override reason`}
                          name={`reason-${r.productId}`}
                          maxLength={500}
                          defaultValue={previous?.reason ?? ""}
                          placeholder="Why this change?"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="planning-actions">
            <p className="muted">
              Generating saves a new draft. No stock changes until HQ approves.
              Estimates use demand ÷ 3 × (1 + buffer), rounded up to whole
              pairs.
            </p>
            <button className="button primary" disabled={busy || query.isError}>
              Generate new plan version
            </button>
          </div>
        </form>
      </section>
      {plan && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Saved plan · {plan.status}</h2>
              <label>
                Version
                <select
                  aria-label="Saved plan version"
                  value={plan.id}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {snapshot.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      v{p.version} · {p.status} ·{" "}
                      {new Date(p.createdAt).toLocaleString("en-GB", {
                        timeZone: "Asia/Yangon",
                      })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Target</th>
                    <th>Carryover</th>
                    <th>Retail movement</th>
                    <th>Incoming</th>
                    <th>Refill</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.productId}>
                      <td>
                        {r.variant}
                        {r.manual && <small>Manual · {r.reason}</small>}
                      </td>
                      <td>{r.target ?? "Needs target"}</td>
                      <td>{r.carryover}</td>
                      <td>{r.retailMove}</td>
                      <td>{r.incoming}</td>
                      <td>{r.target === null ? "—" : r.refill}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="planning-actions">
              <p className="muted">
                Saved at{" "}
                {new Date(plan.createdAt).toLocaleString("en-GB", {
                  timeZone: "Asia/Yangon",
                })}{" "}
                Yangon time. Current inputs above may differ. Incoming stock is
                protected only after physical receipt and a refreshed approval.
              </p>
              <Link className="button secondary" href={`/branches/${branchId}`}>
                Arrange stock refill
              </Link>
            </div>
            {plan.status === "draft" && plan.id === latest?.id && (
              <form
                className="planning-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("approve", {
                    planId: plan.id,
                    reason: String(new FormData(e.currentTarget).get("reason")),
                  });
                }}
              >
                <label className="field">
                  Approval reason
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Confirm this reserve allocation"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy || unresolved || !canFinalize || query.isError}
                >
                  <ShieldCheck size={16} /> Approve branch plan
                </button>
                {!canFinalize && (
                  <p>
                    Preliminary plan: finalize on the last day before the target
                    month or during that month.
                  </p>
                )}
                {unresolved && (
                  <p>
                    Save manual targets for all SKUs with insufficient history
                    before approval.
                  </p>
                )}
              </form>
            )}
            {plan.approvedAt && (
              <p className="info-pad">
                Approved{" "}
                {new Date(plan.approvedAt).toLocaleString("en-GB", {
                  timeZone: "Asia/Yangon",
                })}{" "}
                · {plan.approvalReason}
              </p>
            )}
          </section>
          <section className="panel planning-explanation">
            <div className="panel-heading">
              <h2>
                <Sparkles size={18} /> AI explanation
              </h2>
              <button
                className="button secondary"
                disabled={busy || !query.data?.ai.configured}
                onClick={() =>
                  void explain(plan.explanation.status === "ready")
                }
              >
                {plan.explanation.status === "ready"
                  ? "Regenerate explanation"
                  : plan.explanation.status === "failed"
                    ? "Retry explanation"
                    : "Generate explanation"}
              </button>
            </div>
            <div className="info-pad">
              {!query.data?.ai.configured && (
                <p>
                  AI setup needed: configure the server-only Groq API key.
                  Calculations and approvals remain available.
                </p>
              )}
              {plan.explanation.status === "pending" && (
                <p>
                  Explanation requested. Refresh after it completes; interrupted
                  requests can be retried after one minute.
                </p>
              )}
              {plan.explanation.status === "failed" && (
                <p role="status">
                  <strong>Explanation unavailable.</strong> Retry after at least
                  one minute. Stock calculations and approvals remain available.
                </p>
              )}
              {plan.explanation.summary && <p>{plan.explanation.summary}</p>}
              {!!plan.explanation.cautions?.length && (
                <ul>
                  {plan.explanation.cautions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <small className="muted">
                {plan.explanation.model ?? query.data?.ai.model} · AI explains
                saved calculations; it cannot change quantities. SKU-1, SKU-2, …
                follow the saved table order. Cached per plan version.
              </small>
            </div>
          </section>
        </>
      )}
      {!!snapshot.incoming.length && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Confirm incoming arrivals</h2>
          </div>
          <p className="info-pad">
            Only dispatched refills with a confirmed, non-overdue arrival on or
            before {month} reduce the plan’s additional refill. Confirm only
            stock intended for wholesale backup; retail refills remain separate.
            Receipt remains a separate branch action.
          </p>
          {snapshot.incoming.map((t) => (
            <form
              className="planning-arrival"
              key={t.id}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("arrival", {
                  transferId: t.id,
                  due: String(f.get("due")),
                  reason: String(f.get("reason")),
                });
              }}
            >
              <div>
                <strong>
                  {t.variant} · {t.quantity} pairs
                </strong>
                <small>{t.reference}</small>
              </div>
              <label className="field">
                Expected arrival
                <input
                  name="due"
                  type="date"
                  required
                  min={today}
                  defaultValue={t.due ?? ""}
                />
              </label>
              <label className="field">
                Confirmation reason
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="button secondary" disabled={busy}>
                Confirm backup arrival
              </button>
            </form>
          ))}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Unassigned backup demand</h2>
          <span>{snapshot.unmet.length} orders</span>
        </div>
        <div className="info-pad">
          <p>
            Record “No branch can fulfil” from a paid, held order’s branch
            fulfilment controls. These orders are shown separately and are not
            guessed into any branch’s target.
          </p>
          {snapshot.unmet.map((u) => (
            <p key={u.orderId}>
              {u.reference} · {u.units} pairs · {u.reason}
            </p>
          ))}
        </div>
      </section>
      {busy && (
        <p className="planning-saving" role="status">
          Saving planning changes…
        </p>
      )}
    </>
  );
}
