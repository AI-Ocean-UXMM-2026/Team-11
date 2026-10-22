"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Building2,
  PackagePlus,
  Pencil,
  RefreshCw,
  Truck,
  UserPlus,
  X,
} from "lucide-react";
import type { WorkspaceData, Viewer } from "@/lib/domain";
import type { BranchHistory } from "@/lib/branch-history";
import { productPhoto } from "@/lib/checkout";
import { locationSchema, pinFromForm } from "@/lib/contact";
import { LocationLink } from "./location-link";
import { LocationPicker } from "./location-picker";
import { Pagination } from "./pagination";
import { StockTransfers, useBranchAction } from "./branch-network";
import { BranchBackupSetup } from "./branch-backup-setup";

function BranchDialog({
  title,
  children,
  close,
  pending,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  pending: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal branch-dialog"
      aria-labelledby="branch-dialog-title"
      aria-busy={pending}
      onCancel={(e) => {
        if (pending) e.preventDefault();
        else close();
      }}
    >
      <div className="modal-header">
        <h2 id="branch-dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={pending}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function BranchDetail({
  data,
  viewer,
  demo,
  branchId,
  updated,
}: {
  data: WorkspaceData;
  viewer: Viewer;
  demo: boolean;
  branchId: string;
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
}) {
  const branch = data.branches.find((b) => b.id === branchId);
  const [modal, setModal] = useState<"refill" | "edit" | "drivers" | null>(
    null,
  );
  const [direction, setDirection] = useState("refill");
  const [purpose, setPurpose] = useState<"retail" | "backup">("retail");
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const client = useQueryClient();
  const historyKey = ["branch-transfers", viewer.id, demo, branchId];
  const history = useQuery<BranchHistory>({
    queryKey: [...historyKey, page, pageSize],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/branches/${branchId}/transfers?page=${page}&pageSize=${pageSize}`,
        { signal, cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Unable to load refill history.");
      return body;
    },
    placeholderData: keepPreviousData,
    staleTime: 10000,
    refetchInterval: 30_000,
    retry: 1,
  });
  async function changed(next: WorkspaceData, message?: string) {
    await updated(next, message);
    await client.invalidateQueries({ queryKey: historyKey });
  }
  const { act, error, pending, setError } = useBranchAction(
    changed,
    data.query,
  );
  if (!branch)
    return (
      <section className="panel branch-empty">
        <h2>Branch unavailable</h2>
        <Link href="/branches" className="text-link">
          Back to branches
        </Link>
      </section>
    );
  const drivers = data.accounts.filter(
    (a) => a.role === "driver" && a.branchId === branch.id,
  );
  const product = data.products.find((p) => p.id === productId);
  const inventory = branch.inventory ?? [];
  const source = inventory.find((i) => i.productId === productId);
  const available =
    direction === "return"
      ? purpose === "backup"
        ? (source?.protected ?? 0)
        : Math.max(
            0,
            (source?.onHand ?? 0) -
              (source?.allocated ?? 0) -
              (source?.protected ?? 0),
          )
      : Math.max(0, (product?.stock ?? 0) - (product?.reserve ?? 0));
  const open = branch.active !== false;
  const refillRequests =
    history.data?.refillRequests ??
    data.refillRequests?.filter((r) => r.branchId === branchId) ??
    [];
  function show(next: typeof modal) {
    setError("");
    setDirection("refill");
    setPurpose("retail");
    setModal(next);
  }
  const failure = error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
  return (
    <div className="branch-detail-page">
      <section
        className="panel branch-information"
        aria-labelledby="branch-info-heading"
      >
        <div className="branch-information-header">
          <div className="branch-information-title">
            <span className="branch-icon">
              <Building2 size={24} />
            </span>
            <div>
              <h2 id="branch-info-heading">Branch information</h2>
              <span className={`workflow-status ${open ? "" : "closed"}`}>
                {open ? "Open" : "Closed"}
              </span>
            </div>
          </div>
          <div className="branch-detail-actions">
            {open && (
              <>
                <button
                  className="button secondary"
                  onClick={() => show("edit")}
                >
                  <Pencil size={16} />
                  Edit branch
                </button>
                <button
                  className="button primary"
                  onClick={() => show("refill")}
                >
                  <PackagePlus size={18} />
                  Refill stock
                </button>
              </>
            )}
          </div>
        </div>
        <dl className="branch-information-grid">
          <div>
            <dt>Branch name</dt>
            <dd>{branch.name}</dd>
          </div>
          <div>
            <dt>Manager</dt>
            <dd>{branch.manager || "Not assigned"}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {branch.pin ? (
                <LocationLink pin={branch.pin} label="View branch location" />
              ) : (
                branch.address || "No location pin saved"
              )}
            </dd>
          </div>
          <div>
            <dt>Active staff</dt>
            <dd>{branch.staffCount ?? 0} staff members</dd>
          </div>
        </dl>
        {!open && (
          <p className="inline-note">
            This branch is closed. Its stock and transfer history are retained.
          </p>
        )}
      </section>
      <section
        className="panel branch-stock-panel"
        aria-labelledby="branch-stock-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="branch-stock-heading">Stock units</h2>
            <p className="muted">
              Retail sales and emergency wholesale deliveries use separate stock
              pools. Allocated pairs are already committed to an order or
              transfer.
            </p>
          </div>
          <strong className="branch-total-stock">
            {branch.stock.toLocaleString()} <small>pairs on hand</small>
          </strong>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product / variant</th>
                <th>On hand</th>
                <th>Allocated</th>
                <th>Wholesale backup available</th>
                <th>Backup committed</th>
                <th>Backup target</th>
                <th>Retail available</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((i) => {
                const p = data.products.find((p) => p.id === i.productId);
                return (
                  <tr key={i.productId}>
                    <td>
                      <div className="branch-stock-product">
                        {p && (
                          <Image
                            src={productPhoto(p.color)}
                            alt={`${p.color} sneaker`}
                            width={60}
                            height={48}
                          />
                        )}
                        <span>
                          <strong>{p?.name ?? "STT Everyday sneaker"}</strong>
                          <small>
                            {p ? `${p.color} · EU ${p.size}` : i.variant}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>{i.onHand}</td>
                    <td>{i.allocated}</td>
                    <td>{i.protected}</td>
                    <td>{i.backupAllocated ?? 0}</td>
                    <td>{i.backupTarget ?? "Not configured"}</td>
                    <td>
                      <strong>
                        {Math.max(0, i.onHand - i.allocated - i.protected)}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!inventory.length && (
            <p className="info-pad muted">
              No stock units are available for this branch.
            </p>
          )}
        </div>
      </section>
      <BranchBackupSetup
        branch={branch}
        updated={changed}
        refillBackup={(productId) => {
          show("refill");
          setProductId(productId);
          setPurpose("backup");
        }}
      />
      {refillRequests.length > 0 && (
        <section
          className="panel info-pad"
          aria-labelledby="branch-refill-requests-heading"
        >
          <h2 id="branch-refill-requests-heading">Automatic refill requests</h2>
          <p className="muted">
            HQ is notified when total on-hand stock is below 10 or dedicated
            backup is below its configured target. Review pending refills before
            reserving more stock.
          </p>
          <ul>
            {refillRequests.map((request) => (
              <li key={request.id}>
                <strong>{request.variant}</strong>: {request.onHand} pairs{" "}
                {request.pool === "backup" ? "in backup" : "on hand"} ·
                threshold {request.threshold}
                {request.incoming > 0 && (
                  <> · {request.incoming} pairs in pending refills</>
                )}
              </li>
            ))}
          </ul>
          <button className="button primary" onClick={() => show("refill")}>
            <PackagePlus size={18} /> Refill stock
          </button>
        </section>
      )}
      <section
        className="panel branch-drivers"
        aria-labelledby="branch-drivers-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="branch-drivers-heading">
              Assigned drivers{" "}
              <span className="count-chip">{drivers.length}</span>
            </h2>
            <p className="muted">Drivers affiliated with {branch.name}.</p>
          </div>
          {open && (
            <button
              className="button secondary"
              onClick={() => show("drivers")}
            >
              <UserPlus size={17} />
              Manage drivers
            </button>
          )}
        </div>
        <div className="branch-driver-list">
          {drivers.map((driver) => (
            <div className="branch-driver-row" key={driver.id}>
              <span className="branch-icon">
                <Truck size={22} />
              </span>
              <div>
                <strong>{driver.name}</strong>
                <small>{driver.phone || "No contact number saved"}</small>
              </div>
              <span className="workflow-status">{driver.status}</span>
            </div>
          ))}
          {!drivers.length && (
            <p className="info-pad muted">
              No drivers assigned yet. Assign a driver to make deliveries from
              this branch.
            </p>
          )}
        </div>
      </section>
      <div aria-busy={history.isFetching}>
        {history.error && (
          <div className="branch-history-error" role="alert">
            <p>{history.error.message}</p>
            <button
              className="button secondary"
              onClick={() => history.refetch()}
            >
              Retry history
            </button>
          </div>
        )}
        {history.data ? (
          <StockTransfers
            title="Stock refillment history"
            data={{
              ...data,
              transfers: history.data.rows,
              summary: {
                ...data.summary!,
                pendingTransfers: history.data.pending,
              },
            }}
            viewer={viewer}
            updated={changed}
            pagination={
              <div className="branch-history-footer">
                <button
                  className="text-link"
                  disabled={history.isFetching}
                  onClick={() => history.refetch()}
                >
                  <RefreshCw size={15} />
                  Refresh history
                </button>
                <Pagination
                  info={history.data.pagination}
                  label="Branch transfers"
                  busy={history.isFetching}
                  change={(p, size) => {
                    setPage(p);
                    setPageSize(size);
                  }}
                />
              </div>
            }
          />
        ) : (
          !history.error && (
            <section className="panel info-pad">
              <h2>Stock refillment history</h2>
              <p className="muted" role="status">
                Loading branch transfers…
              </p>
            </section>
          )
        )}
      </div>
      {open && (
        <details className="branch-close">
          <summary>Close this branch</summary>
          <form
            className="workflow-form"
            onSubmit={(e) => {
              e.preventDefault();
              act("branch_close", {
                branchId: branch.id,
                reason: new FormData(e.currentTarget).get("reason"),
              });
            }}
          >
            <p>
              Return all stock and resolve deliveries, handoffs and transfers
              first. Closure preserves history and suspends the branch’s staff
              and drivers.
            </p>
            <label className="field">
              Closure reason
              <textarea name="reason" minLength={3} maxLength={1000} required />
            </label>
            <label className="workflow-checkbox">
              <input type="checkbox" required />I confirm this branch is no
              longer operating.
            </label>
            <button className="button secondary" disabled={pending}>
              Confirm branch closure
            </button>
          </form>
        </details>
      )}
      {!modal && failure}
      {modal && (
        <BranchDialog
          title={
            modal === "refill"
              ? direction === "return"
                ? "Return stock to HQ"
                : "Refill stock"
              : modal === "edit"
                ? "Edit branch"
                : "Manage assigned drivers"
          }
          pending={pending}
          close={() => setModal(null)}
        >
          {modal === "refill" && (
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                const quantity = Number(values.get("quantity"));
                if (
                  !Number.isInteger(quantity) ||
                  quantity < 1 ||
                  quantity > available
                ) {
                  setError(
                    "Enter a whole number of pairs within the available source stock.",
                  );
                  return;
                }
                act(
                  "transfer_create",
                  {
                    productId,
                    quantity,
                    reason: values.get("reason"),
                    purpose,
                    sourceBranchId: direction === "return" ? branch.id : "",
                    destinationBranchId:
                      direction === "return" ? "" : branch.id,
                  },
                  () => setModal(null),
                );
              }}
            >
              <p className="muted">
                {direction === "return"
                  ? `${branch.name} → STT Yangon HQ`
                  : `STT Yangon HQ → ${branch.name}`}
              </p>
              <label className="field">
                Stock movement
                <select
                  value={direction}
                  onChange={(e) => {
                    setDirection(e.target.value);
                    setError("");
                  }}
                >
                  <option value="refill">Refill branch from HQ</option>
                  <option value="return">Return branch stock to HQ</option>
                </select>
              </label>
              <label className="field">
                Stock pool
                <select
                  value={purpose}
                  onChange={(e) => {
                    setPurpose(e.target.value as "retail" | "backup");
                    setError("");
                  }}
                >
                  <option value="retail">Retail shop stock</option>
                  <option value="backup">Wholesale backup stock</option>
                </select>
              </label>
              <label className="field">
                Shoe variant
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setError("");
                  }}
                  required
                >
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.color} sneaker · EU {p.size}
                    </option>
                  ))}
                </select>
                <small>
                  {available.toLocaleString()} pairs available at{" "}
                  {direction === "return" ? branch.name : "HQ"}
                </small>
              </label>
              <div className="form-grid">
                <label className="field">
                  Pairs
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    max={available}
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
                    placeholder="e.g. Weekly stock refill"
                    required
                  />
                </label>
              </div>
              <p className="inline-note">
                This reserves stock at the source. Confirm dispatch in the
                transfer history; the destination confirms physical receipt
                before its stock increases.
                {purpose === "backup" &&
                  " Branch receipt adds these pairs directly to the dedicated wholesale backup pool."}
              </p>
              {failure}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={pending}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={pending || available < 1}
                >
                  {pending
                    ? "Reserving stock…"
                    : direction === "return"
                      ? "Reserve return"
                      : "Reserve refill"}
                </button>
              </div>
            </form>
          )}
          {modal === "edit" && (
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                const pin = locationSchema.safeParse(pinFromForm(values));
                if (!pin.success) {
                  setError("Choose the branch location on the map.");
                  return;
                }
                act(
                  "branch_update",
                  {
                    branchId: branch.id,
                    name: values.get("name"),
                    manager: values.get("manager"),
                    pin: pin.data,
                  },
                  () => setModal(null),
                );
              }}
            >
              <div className="form-grid">
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
                  Manager
                  <input
                    name="manager"
                    defaultValue={branch.manager}
                    maxLength={100}
                  />
                </label>
              </div>
              <LocationPicker
                required
                initialPin={branch.pin ?? undefined}
                label="Branch location pin"
              />
              {failure}
              <button className="button primary" disabled={pending}>
                Save branch details
              </button>
            </form>
          )}
          {modal === "drivers" && (
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                act(
                  "driver_affiliation",
                  {
                    driverId: values.get("driverId"),
                    branchId: values.get("branchId"),
                    reason: values.get("reason"),
                  },
                  () => setModal(null),
                );
              }}
            >
              <p className="muted">
                Assign a driver to {branch.name}, or move an affiliated driver
                back to HQ. Active deliveries must be resolved before
                reassignment.
              </p>
              <label className="field">
                Driver
                <select name="driverId" required>
                  <option value="">Choose driver</option>
                  {data.accounts
                    .filter(
                      (a) => a.role === "driver" && a.status !== "Suspended",
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.branchName ?? "HQ"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Assigned location
                <select name="branchId" defaultValue={branch.id}>
                  <option value={branch.id}>{branch.name}</option>
                  <option value="">STT Yangon HQ</option>
                </select>
              </label>
              <label className="field">
                Reason
                <input name="reason" minLength={3} maxLength={300} required />
              </label>
              {failure}
              <button className="button primary" disabled={pending}>
                Update driver affiliation
              </button>
            </form>
          )}
        </BranchDialog>
      )}
    </div>
  );
}
