"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  Building2,
  Package,
  Truck,
  Plus,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { workflowAction } from "@/app/workflow-actions";
import type { WorkspaceData, Viewer } from "@/lib/domain";

function useBranchAction(
  updated: (data: WorkspaceData, message?: string) => void,
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
        const r = await workflowAction(action, payload, key);
        if (r.error) setError(r.error);
        else if (r.data) {
          retry.current = null;
          updated(r.data, r.result?.message);
          done?.();
        }
      } catch {
        setError("Connection interrupted. Retry the same details.");
      }
    });
  }
  return { act, pending, error };
}
export function BranchNetwork({
  data,
  updated,
}: {
  data: WorkspaceData;
  updated: (data: WorkspaceData, message?: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const { act, pending, error } = useBranchAction(updated);
  const branch = data.branches.find((b) => b.id === selected);
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
            {open.reduce((s, b) => s + b.stock, 0)} <small>pairs</small>
          </strong>
        </div>
        <div>
          <span>Affiliated drivers</span>
          <strong>{open.reduce((s, b) => s + (b.driverCount ?? 0), 0)}</strong>
        </div>
        <button
          className="button primary"
          onClick={() => setCreating(!creating)}
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
              const v = Object.fromEntries(new FormData(form));
              act("branch_create", v, () => {
                form.reset();
                setCreating(false);
              });
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
            <label className="field">
              Full address
              <textarea name="address" minLength={5} maxLength={300} required />
            </label>
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
          <section
            className={`panel branch-network-card ${selected === b.id ? "selected" : ""}`}
            key={b.id}
          >
            <div className="heading-inline">
              <span className="branch-icon">
                <Building2 size={23} />
              </span>
              <span
                className={`workflow-status ${b.active === false ? "closed" : ""}`}
              >
                {b.active === false ? "Closed" : "Open"}
              </span>
            </div>
            <h2>{b.name}</h2>
            <p className="muted">{b.address}</p>
            <div className="branch-card-metrics">
              <span>
                <Package size={16} />
                {b.stock} pairs
              </span>
              <span>
                <Truck size={16} />
                {b.driverCount ?? 0} drivers
              </span>
            </div>
            <small className="muted">
              {b.staffCount ?? 0} active staff · {b.lowStock} low-stock variants
            </small>
            <button
              className="button secondary full-width"
              onClick={() => setSelected(b.id)}
            >
              Manage location
              <ArrowRight size={15} />
            </button>
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
      {branch && (
        <section className="panel branch-detail" key={branch.id}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LOCATION DETAILS</span>
              <h2>{branch.name}</h2>
            </div>
            <button className="text-link" onClick={() => setSelected("")}>
              Close details
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>On hand</th>
                  <th>Allocated</th>
                  <th>Protected</th>
                  <th>Retail available</th>
                </tr>
              </thead>
              <tbody>
                {branch.inventory?.map((i) => (
                  <tr key={i.productId}>
                    <td>{i.variant}</td>
                    <td>{i.onHand}</td>
                    <td>{i.allocated}</td>
                    <td>{i.protected}</td>
                    <td>{i.onHand - i.allocated - i.protected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {branch.active !== false ? (
            <>
              <div className="info-pad">
                <Link className="text-link" href="/accounts">
                  Issue branch staff or driver credentials
                  <ArrowRight size={14} />
                </Link>
                <p className="muted">
                  Branch staff use /branch/login. The account determines which
                  location they can access.
                </p>
              </div>
              <div className="branch-management-grid">
                <form
                  className="modal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Object.fromEntries(new FormData(e.currentTarget));
                    act("branch_update", { ...v, branchId: branch.id });
                  }}
                >
                  <h3>Edit location</h3>
                  <label className="field">
                    Branch name
                    <input
                      name="name"
                      defaultValue={branch.name}
                      minLength={2}
                      maxLength={100}
                      required
                    />
                  </label>
                  <label className="field">
                    Full address
                    <textarea
                      name="address"
                      defaultValue={branch.address}
                      minLength={5}
                      maxLength={300}
                      required
                    />
                  </label>
                  <label className="field">
                    Manager
                    <input
                      name="manager"
                      defaultValue={branch.manager}
                      maxLength={100}
                    />
                  </label>
                  <button className="button secondary" disabled={pending}>
                    Save branch details
                  </button>
                </form>
                <form
                  className="modal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Object.fromEntries(new FormData(e.currentTarget));
                    act("transfer_create", {
                      productId: v.productId,
                      quantity: Number(v.quantity),
                      reason: v.reason,
                      sourceBranchId: v.direction === "return" ? branch.id : "",
                      destinationBranchId:
                        v.direction === "return" ? "" : branch.id,
                    });
                  }}
                >
                  <h3>Refill or return stock</h3>
                  <label className="field">
                    Direction
                    <select name="direction">
                      <option value="refill">HQ → {branch.name}</option>
                      <option value="return">{branch.name} → HQ</option>
                    </select>
                  </label>
                  <label className="field">
                    Shoe variant
                    <select name="productId">
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.pack}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      Pairs
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        max={1000000}
                        step={1}
                        required
                      />
                    </label>
                    <label className="field">
                      Reason
                      <input
                        name="reason"
                        minLength={3}
                        maxLength={300}
                        required
                      />
                    </label>
                  </div>
                  <small className="muted">
                    Reserves stock at the source. The source confirms dispatch;
                    the destination confirms physical receipt. HQ-authorized
                    returns may release protected branch reserve.
                  </small>
                  <button className="button primary" disabled={pending}>
                    Reserve transfer
                  </button>
                </form>
              </div>
              <details className="branch-close">
                <summary>Close this location</summary>
                <form
                  className="workflow-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Object.fromEntries(new FormData(e.currentTarget));
                    act("branch_close", {
                      branchId: branch.id,
                      reason: v.reason,
                    });
                  }}
                >
                  <p>
                    Return all stock and finish deliveries and transfers first.
                    Closure suspends this location’s staff and drivers while
                    keeping its history.
                  </p>
                  <label className="field">
                    Closure reason
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <label className="workflow-checkbox">
                    <input type="checkbox" required />I confirm this branch is
                    no longer operating.
                  </label>
                  <button className="button secondary" disabled={pending}>
                    Confirm branch closure
                  </button>
                </form>
              </details>
            </>
          ) : (
            <div className="inline-note">
              <ShieldCheck size={18} />
              Closed location. Its historical orders and stock movements are
              retained.
            </div>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Driver affiliations</h2>
        </div>
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            act("driver_affiliation", v);
          }}
        >
          <div className="form-grid">
            <label className="field">
              Driver
              <select name="driverId" required>
                <option value="">Choose driver</option>
                {data.accounts
                  .filter((a) => a.role === "driver")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.branchName ?? "HQ"}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Assigned location
              <select name="branchId">
                <option value="">STT Yangon HQ</option>
                {open.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Reason
            <input name="reason" minLength={3} maxLength={300} required />
          </label>
          <button className="button secondary" disabled={pending}>
            Update affiliation
          </button>
          <small className="muted">
            Active delivery assignments must be resolved before a driver changes
            location.
          </small>
        </form>
      </section>
      <StockTransfers
        data={data}
        viewer={{ id: "", name: "HQ", role: "hq" }}
        updated={updated}
      />
      {error && (
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
}: {
  data: WorkspaceData;
  viewer: Viewer;
  updated: (data: WorkspaceData, message?: string) => void;
}) {
  const { act, pending, error } = useBranchAction(updated);
  return (
    <section className="panel stock-transfer-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PHYSICAL STOCK MOVEMENT</span>
          <h2>Refills & returns</h2>
        </div>
        <span className="count-chip">
          {data.transfers?.filter((t) =>
            ["reserved", "shipping"].includes(t.status),
          ).length ?? 0}{" "}
          pending
        </span>
      </div>
      <div className="transfer-list">
        {data.transfers?.map((t) => {
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
                    {t.reference} · {t.variant} · {t.quantity} pairs
                  </small>
                </span>
                <span className="workflow-status">{t.status}</span>
              </summary>
              <p className="muted">{t.reason}</p>
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
                    pairs were physically{" "}
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
        {!data.transfers?.length && (
          <p className="info-pad muted">
            No stock transfers yet. Incoming stock becomes available only after
            receipt confirmation.
          </p>
        )}
      </div>
      {error && (
        <p className="form-error info-pad" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
