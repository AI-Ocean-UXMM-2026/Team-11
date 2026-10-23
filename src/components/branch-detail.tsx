"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Building2, PackagePlus, Pencil, RefreshCw, X } from "lucide-react";
import type { WorkspaceData, Viewer } from "@/lib/domain";
import type { BranchHistory } from "@/lib/branch-history";
import type { BackupPlanningDetail } from "@/lib/stock-planning";
import { productPhoto, productUnit } from "@/lib/checkout";
import { locationSchema, pinFromForm } from "@/lib/contact";
import { statusToneClass } from "@/lib/status-tone";
import { LocationLink } from "./location-link";
import { LocationPicker } from "./location-picker";
import { Pagination } from "./pagination";
import { StockTransfers, useBranchAction } from "./branch-network";

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
  const [modal, setModal] = useState<"refill" | "edit" | null>(null);
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
  const backupPlan = useQuery<BackupPlanningDetail>({
    queryKey: ["backup-detail", viewer.id, demo, branchId, productId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        view: "detail",
        branchId,
        productId,
      });
      const response = await fetch(`/api/stock-planning?${params}`, {
        signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.data)
        throw new Error(body.error ?? "Unable to load saved backup settings.");
      return body.data;
    },
    enabled:
      modal === "refill" && direction === "refill" && purpose === "backup",
    retry: false,
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
  const currentBranch = branch;
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
  const backupRow = backupPlan.data?.row;
  const backupSuggestedRefill = backupRow?.proposedRefill ?? null;
  const backupRefillQuantity =
    backupSuggestedRefill === null
      ? 0
      : Math.min(backupSuggestedRefill, available);
  const open = branch.active !== false;
  function show(next: typeof modal) {
    setError("");
    setDirection("refill");
    setPurpose(
      next === "refill" &&
        (currentBranch.inventory ?? []).some(
          (item) =>
            item.productId === productId &&
            item.backupTarget !== null &&
            item.backupTarget !== undefined,
        )
        ? "backup"
        : "retail",
    );
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
              <span
                className={`workflow-status ${statusToneClass(open ? "Open" : "Closed")}`}
              >
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
              pools. Allocated units are already committed to an order or
              transfer.
            </p>
          </div>
          <strong className="branch-total-stock">
            {branch.stock.toLocaleString()} <small>units on hand</small>
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
                            src={productPhoto(p)}
                            alt={`${p.name}, ${p.pack}`}
                            width={60}
                            height={48}
                          />
                        )}
                        <span>
                          <strong>{p?.name ?? "Product"}</strong>
                          <small>{p ? p.pack : i.variant}</small>
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
                : "Refill stock"
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
                    "Enter a whole number within the available source stock.",
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
                  ? `${branch.name} → Oceanpride Longyi HQ`
                  : `Oceanpride Longyi HQ → ${branch.name}`}
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
              {direction === "refill" &&
                purpose === "backup" &&
                (backupPlan.isPending ? (
                  <p className="inline-note" role="status">
                    Loading the saved backup target…
                  </p>
                ) : backupPlan.isError ? (
                  <div className="form-error" role="alert">
                    <p>{backupPlan.error.message}</p>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void backupPlan.refetch()}
                    >
                      Retry loading backup settings
                    </button>
                  </div>
                ) : backupRow?.target !== null && backupRow ? (
                  <p className="inline-note">
                    Saved target: {backupRow.target} {backupRow.unit} · Current
                    backup: {backupRow.available} {backupRow.unit} · Incoming:{" "}
                    {backupRow.incoming} {backupRow.unit}.
                    {backupRow.openRefills > 0
                      ? ` ${backupRow.openRefills} backup refill${backupRow.openRefills === 1 ? " is" : "s are"} already open.`
                      : backupSuggestedRefill
                        ? ` Suggested refill: ${backupSuggestedRefill} ${backupRow.unit}${backupSuggestedRefill > available ? `; HQ has ${available} available, so the quantity is capped.` : "."}`
                        : " No refill is needed to meet the saved target."}
                  </p>
                ) : (
                  <p className="inline-note">
                    No saved backup target for this SKU. You can enter a manual
                    refill amount or configure the target in Stock Planning.
                  </p>
                ))}
              <label className="field">
                Longyi style
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
                      {p.name} · {p.pack}
                    </option>
                  ))}
                </select>
                <small>
                  {available.toLocaleString()}{" "}
                  {product ? `${productUnit(product)}s` : "units"} available at{" "}
                  {direction === "return" ? branch.name : "HQ"}
                </small>
              </label>
              <div className="form-grid">
                <label className="field">
                  {direction === "refill" && purpose === "backup"
                    ? (backupRow?.unit ?? "Pairs")
                    : "Pairs"}
                  <input
                    key={`${productId}:${purpose}:${backupPlan.data?.row.proposedRefill ?? "pending"}`}
                    name="quantity"
                    type="number"
                    min={1}
                    max={available}
                    step={1}
                    required
                    defaultValue={
                      direction === "refill" && purpose === "backup"
                        ? backupRefillQuantity || undefined
                        : undefined
                    }
                    disabled={
                      direction === "refill" &&
                      purpose === "backup" &&
                      backupPlan.isPending
                    }
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
                  " Branch receipt adds these units directly to the dedicated wholesale backup pool."}
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
                  disabled={
                    pending ||
                    available < 1 ||
                    (direction === "refill" &&
                      purpose === "backup" &&
                      (backupPlan.isPending ||
                        backupPlan.isError ||
                        (backupRow?.openRefills ?? 0) > 0 ||
                        (backupRow?.target !== null &&
                          backupRow?.target !== undefined &&
                          !backupSuggestedRefill)))
                  }
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
        </BranchDialog>
      )}
    </div>
  );
}
