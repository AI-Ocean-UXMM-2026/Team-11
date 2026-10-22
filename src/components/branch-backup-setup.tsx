"use client";
import Link from "next/link";
import { useState } from "react";
import type { Branch, WorkspaceData } from "@/lib/domain";
import { useBranchAction } from "./branch-network";

export function BranchBackupSetup({
  branch,
  updated,
  refillBackup,
}: {
  branch: Branch;
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
  refillBackup: (productId: string) => void;
}) {
  const inventory = branch.inventory ?? [];
  const [productId, setProductId] = useState(inventory[0]?.productId ?? "");
  const { act, pending, error } = useBranchAction(updated);
  const selected = inventory.find((i) => i.productId === productId);
  if (!selected || branch.active === false) return null;
  const retailAvailable =
    selected.onHand - selected.allocated - selected.protected;
  return (
    <section
      className="panel"
      id="backup-setup"
      aria-labelledby="backup-setup-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="backup-setup-heading">Wholesale backup setup</h2>
          <p>
            Set the starting reserve manually while history builds. Branch
            takeovers use only dedicated backup stock. Retail sales use the
            retail pool.
          </p>
        </div>
      </div>
      <form
        className="modal-form"
        key={`${productId}:${selected.backupTarget}:${selected.protected}`}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          act("backup_configure", {
            branchId: branch.id,
            productId,
            target: Number(form.get("target")),
            retailMove: Number(form.get("retailMove")),
            reason: String(form.get("reason")),
          });
        }}
      >
        <label className="field">
          Backup shoe variant
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            {inventory.map((i) => (
              <option key={i.productId} value={i.productId}>
                {i.variant}
              </option>
            ))}
          </select>
        </label>
        <p className="inline-note">
          {selected.protected} backup pairs available ·{" "}
          {selected.backupAllocated ?? 0} backup pairs committed ·{" "}
          {retailAvailable} retail pairs available.
        </p>
        <div className="form-grid">
          <label className="field">
            Desired backup target (pairs)
            <input
              name="target"
              type="number"
              min={0}
              max={1000000}
              step={1}
              required
              defaultValue={selected.backupTarget ?? selected.protected}
            />
          </label>
          <label className="field">
            Explicit retail → backup movement (pairs)
            <input
              name="retailMove"
              type="number"
              min={0}
              max={retailAvailable}
              step={1}
              required
              defaultValue={0}
            />
          </label>
        </div>
        <p className="muted">
          Leave movement at 0 to keep retail stock separate and refill backup
          from HQ. A lower target releases excess unallocated backup stock to
          retail. Already committed pairs stay reserved.
        </p>
        <label className="field">
          Backup configuration reason
          <input
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Initial emergency reserve approved by HQ"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="branch-detail-actions">
          <button className="button primary" disabled={pending}>
            {pending ? "Saving backup…" : "Save backup configuration"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => refillBackup(productId)}
          >
            Refill wholesale backup
          </button>
          <Link
            className="button secondary"
            href={`/stock-planning?branchId=${branch.id}`}
          >
            Review backup suggestion
          </Link>
        </div>
        <small className="muted">
          The target takes effect immediately. Stock arrives through a separate
          HQ backup refill. Suggestions use recorded takeover demand when enough
          history is available; HQ reviews every plan.
        </small>
      </form>
    </section>
  );
}
