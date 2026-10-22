"use client";
import { LocationLink } from "./location-link";
import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Building2, Package, Truck, Plus, ArrowRight } from "lucide-react";
import { workflowAction } from "@/app/workflow-actions";
import type { WorkspaceQuery } from "@/lib/workflow/query";
import type { WorkspaceData, Viewer } from "@/lib/domain";
import { variantUnit } from "@/lib/checkout";
import { LocationPicker } from "./location-picker";
import { locationSchema, pinFromForm } from "@/lib/contact";
import { statusToneClass } from "@/lib/status-tone";

export function useBranchAction(
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>,
  query: WorkspaceQuery = {},
) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  function act(
    action: string,
    payload: Record<string, unknown>,
    done?: () => void,
  ) {
    const fingerprint = JSON.stringify([action, payload]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const key = retry.current.key;
    setError("");
    start(async () => {
      try {
        const r = await workflowAction(action, payload, key, query);
        if (r.error) setError(r.error);
        else if (r.data) {
          await updated(r.data, r.result?.message);
          retry.current = null;
          done?.();
        }
      } catch {
        setError("Connection interrupted. Retry the same details.");
      }
    });
  }
  return { act, pending, error, setError };
}
export function BranchNetwork({
  data,
  updated,
}: {
  data: WorkspaceData;
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const { act, pending, error, setError } = useBranchAction(
    updated,
    data.query,
  );
  const open = data.branches.filter((b) => b.active !== false);
  return (
    <div className="branch-workspace">
      <div className="branch-summary">
        <div>
          <span>Open locations</span>
          <strong>{open.length}</strong>
        </div>
        <div>
          <span>Branch stock</span>
          <strong>
            {open.reduce((s, b) => s + b.stock, 0)} <small>units</small>
          </strong>
        </div>
        <div>
          <span>Affiliated drivers</span>
          <strong>{open.reduce((s, b) => s + (b.driverCount ?? 0), 0)}</strong>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setCreating(!creating);
          }}
        >
          <Plus size={16} />
          Create branch
        </button>
      </div>
      {creating && (
        <section className="panel">
          <div className="panel-heading">
            <h2>A new location for your network</h2>
          </div>
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = new FormData(form);
              const pin = locationSchema.safeParse(pinFromForm(values));
              if (!pin.success) {
                setError("Choose the branch location on the map.");
                return;
              }
              act(
                "branch_create",
                {
                  name: values.get("name"),
                  manager: values.get("manager"),
                  pin: pin.data,
                },
                () => {
                  form.reset();
                  setCreating(false);
                },
              );
            }}
          >
            <div className="form-grid">
              <label className="field">
                Branch name
                <input
                  name="name"
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="e.g. Hlaing branch"
                />
              </label>
              <label className="field">
                Manager name
                <input name="manager" maxLength={100} />
              </label>
            </div>
            <LocationPicker required label="Branch location pin" />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="muted">
              New branches start with zero stock. Issue the branch staff login
              from Accounts, then send its opening stock.
            </p>
            <button className="button primary" disabled={pending}>
              Create location
            </button>
          </form>
        </section>
      )}
      <div className="branch-grid">
        {data.branches.map((b) => (
          <section className="panel branch-network-card" key={b.id}>
            <div className="heading-inline">
              <span className="branch-icon">
                <Building2 size={23} />
              </span>
              <span
                className={`workflow-status ${statusToneClass(b.active === false ? "Closed" : "Open")}`}
              >
                {b.active === false ? "Closed" : "Open"}
              </span>
            </div>
            <h2>{b.name}</h2>
            <div className="branch-pool-summary">
              <div>
                <small>Retail shop</small>
                <strong>
                  {b.retailStock ??
                    b.inventory?.reduce(
                      (sum, i) => sum + i.onHand - i.allocated - i.protected,
                      0,
                    ) ??
                    0}{" "}
                  <small>units available</small>
                </strong>
              </div>
              <div>
                <small>Wholesale backup</small>
                <strong>
                  {b.backupStock ??
                    b.inventory?.reduce((sum, i) => sum + i.protected, 0) ??
                    0}{" "}
                  <small>units available</small>
                </strong>
              </div>
            </div>
            {b.pin ? (
              <LocationLink pin={b.pin} label="View location pin" />
            ) : (
              <p className="muted">{b.address}</p>
            )}
            <div className="branch-card-metrics">
              <span>
                <Package size={16} />
                {b.stock} units
              </span>
              <span>
                <Truck size={16} />
                {b.driverCount ?? 0} drivers
              </span>
            </div>
            <small className="muted">
              {b.staffCount ?? 0} active staff · {b.lowStock} low-stock variants
            </small>
            <Link
              className="button secondary full-width"
              href={`/branches/${b.id}`}
            >
              Manage branch
              <ArrowRight size={15} />
            </Link>
            {b.active !== false && (
              <Link
                className="text-link"
                href={`/stock-planning?branchId=${b.id}`}
              >
                Review backup suggestion <ArrowRight size={15} />
              </Link>
            )}
          </section>
        ))}
      </div>
      {!data.branches.length && (
        <div className="panel branch-empty">
          <Building2 size={32} />
          <h2>Your first branch starts here.</h2>
          <p>Create the location, issue its login, then send a stock refill.</p>
        </div>
      )}
      {error && !creating && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function StockTransfers({
  data,
  viewer,
  updated,
  pagination,
  title = "Refills & returns",
  mode = "all",
}: {
  data: WorkspaceData;
  viewer: Viewer;
  pagination?: ReactNode;
  title?: string;
  mode?: "all" | "incoming-pending";
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
}) {
  const { act, pending, error } = useBranchAction(updated, data.query);
  const transfers =
    mode === "incoming-pending"
      ? (data.transfers ?? []).filter(
          (transfer) =>
            transfer.status === "shipping" &&
            transfer.destinationBranchId === viewer.branchId,
        )
      : (data.transfers ?? []);
  return (
    <section className="panel stock-transfer-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PHYSICAL STOCK MOVEMENT</span>
          <h2>{title}</h2>
        </div>
        <span className="count-chip">
          {mode === "incoming-pending"
            ? `${transfers.length} awaiting receipt`
            : `${data.summary?.pendingTransfers ?? 0} pending`}
        </span>
      </div>
      <div className="transfer-list">
        {transfers.map((t) => {
          const source =
            viewer.role === "hq"
              ? t.sourceBranchId === null
              : t.sourceBranchId === viewer.branchId;
          const destination =
            viewer.role === "hq"
              ? t.destinationBranchId === null
              : t.destinationBranchId === viewer.branchId;
          const action =
            t.status === "reserved" && source
              ? "transfer_dispatch"
              : t.status === "shipping" && destination
                ? "transfer_receive"
                : null;
          return (
            <details className="transfer-row" key={t.id}>
              <summary>
                <span>
                  <strong>
                    {t.source} → {t.destination}
                  </strong>
                  <small>
                    {t.reference} · {t.variant} · {t.quantity}{" "}
                    {variantUnit(t.variant)}
                    {t.quantity === 1 ? "" : "s"}
                  </small>
                </span>
                <span
                  className={`workflow-status ${statusToneClass(t.status)}`}
                >
                  {t.status}
                </span>
              </summary>
              <p className="muted">{t.reason}</p>
              <p className="inline-note">
                {t.purpose === "backup"
                  ? "Wholesale backup stock — kept separate from retail on receipt."
                  : "Retail shop stock"}
              </p>
              <small>
                Created{" "}
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: "Asia/Yangon",
                  dateStyle: "medium",
                }).format(new Date(t.createdAt))}
              </small>
              {action && (
                <form
                  className="workflow-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(action, { transferId: t.id, confirmed: true });
                  }}
                >
                  <label className="workflow-checkbox">
                    <input type="checkbox" required />I confirm all {t.quantity}{" "}
                    units were physically{" "}
                    {action === "transfer_dispatch"
                      ? "dispatched from this location"
                      : "received at this location"}
                    .
                  </label>
                  <button className="button primary" disabled={pending}>
                    {action === "transfer_dispatch"
                      ? "Confirm dispatch"
                      : "Confirm receipt & add stock"}
                  </button>
                </form>
              )}
              {t.status === "reserved" && viewer.role === "hq" && (
                <form
                  className="workflow-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("transfer_cancel", {
                      transferId: t.id,
                      reason: new FormData(e.currentTarget).get("reason"),
                    });
                  }}
                >
                  <label className="field">
                    Cancellation reason
                    <input name="reason" minLength={3} required />
                  </label>
                  <button className="text-link" disabled={pending}>
                    Cancel reserved transfer
                  </button>
                </form>
              )}
            </details>
          );
        })}
        {!transfers.length && (
          <p className="info-pad muted">
            {mode === "incoming-pending"
              ? "No incoming stock is waiting for your receipt confirmation."
              : "No stock transfers yet. Incoming stock becomes available only after receipt confirmation."}
          </p>
        )}
      </div>
      {pagination}
      {error && (
        <p className="form-error info-pad" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
