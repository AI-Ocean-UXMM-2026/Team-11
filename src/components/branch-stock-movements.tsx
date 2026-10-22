"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import type { Viewer, WorkspaceData } from "@/lib/domain";
import type { BranchStockMovementPage } from "@/lib/workflow/stock-movements";
import { StockTransfers } from "./branch-network";

async function readHistory(branch: string, page: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page) });
  if (branch) params.set("branch", branch);
  const response = await fetch(`/api/stock-movements?${params}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Unable to load stock movement records.");
  return body.data as BranchStockMovementPage;
}

const quantity = (value: number) => value.toLocaleString();
const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Yangon",
    dateStyle: "medium",
    timeStyle: "short",
  });
function movementLabel(kind: string) {
  const labels: Record<string, string> = {
    physical_in_retail: "Physical stock received · Retail",
    physical_out_retail: "Physical stock removed · Retail",
    physical_in_backup: "Physical stock received · Wholesale backup",
    physical_out_backup: "Physical stock removed · Wholesale backup",
    adjustment: "Stock adjustment",
    retail: "Retail sale",
    dispatch: "Wholesale dispatch",
    transfer_in: "Physical stock received",
    transfer_out: "Transfer sent",
  };
  if (labels[kind]) return labels[kind];
  if (kind.startsWith("dispatch:")) return "Wholesale dispatch";
  if (kind.startsWith("return_original:")) return "Returned to original order";
  if (kind.startsWith("phase:")) return "Wholesale order dispatch";
  return kind.replaceAll("_", " ");
}

export function BranchStockMovements({
  data,
  viewer,
  updated,
  refresh,
  transferPagination,
}: {
  data: WorkspaceData;
  viewer: Viewer;
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
  refresh: () => Promise<unknown>;
  transferPagination?: ReactNode;
}) {
  const [tab, setTab] = useState<"manage" | "record">("manage");
  const branchId = viewer.branchId ?? "";
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["branch-stock-movements", viewer.id, branchId, page],
    queryFn: ({ signal }) => readHistory(branchId, page, signal),
    enabled: tab === "record",
    retry: false,
  });
  const selectedBranch = data.branches.find((branch) => branch.id === branchId);

  if (viewer.role !== "branch" || !branchId)
    return (
      <p role="alert">
        Stock movements are available to an active branch account.
      </p>
    );

  return (
    <div className="branch-movements">
      <section className="panel branch-movement-panel">
        <div className="branch-movement-heading">
          <div>
            <p className="greeting">Branch inventory</p>
            <h2>Manage Stock Movement</h2>
            <p>
              Confirm incoming physical stock here. Stock is added to your
              branch only after you confirm receipt.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => void refresh()}
            aria-label="Refresh branch stock"
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>
        <div
          className="branch-movement-tabs"
          role="tablist"
          aria-label="Stock movement sections"
        >
          <button
            role="tab"
            aria-selected={tab === "manage"}
            className={tab === "manage" ? "selected" : ""}
            onClick={() => setTab("manage")}
          >
            <ArrowDownToLine size={16} aria-hidden="true" /> Manage Stock
            Movement
          </button>
          <button
            role="tab"
            aria-selected={tab === "record"}
            className={tab === "record" ? "selected" : ""}
            onClick={() => setTab("record")}
          >
            <ClipboardList size={16} aria-hidden="true" /> Record
          </button>
        </div>

        {tab === "manage" ? (
          <>
            <StockTransfers
              data={data}
              viewer={viewer}
              title="Awaiting receipt confirmation"
              mode="incoming-pending"
              updated={async (nextData, message) => {
                await updated(nextData, message);
                await queryClient.invalidateQueries({
                  queryKey: ["branch-stock-movements"],
                });
              }}
              pagination={transferPagination}
            />
          </>
        ) : (
          <section
            className="branch-movement-records"
            aria-label="Branch stock movement record"
          >
            <div className="branch-movement-record-heading">
              <div>
                <h3>Received physical stock</h3>
                <p>
                  Review incoming stock after your branch confirms receipt and
                  it has been added to inventory.
                </p>
              </div>
              <span className="branch-movement-branch-label">
                {selectedBranch?.name ?? "Your branch"}
              </span>
            </div>
            {history.isPending ? (
              <p className="inline-note">Loading branch movement records…</p>
            ) : history.error ? (
              <div className="inline-note" role="alert">
                {history.error.message}
              </div>
            ) : history.data?.rows.length ? (
              <>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Stock movement records"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Branch</th>
                        <th>Shoe variant</th>
                        <th>Movement</th>
                        <th>Quantity</th>
                        <th>Reason</th>
                        <th>Recorded by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{dateTime(row.createdAt)}</td>
                          <td>{row.branchName}</td>
                          <td>{row.variant}</td>
                          <td>{movementLabel(row.kind)}</td>
                          <td>
                            <strong
                              className={
                                row.quantity > 0
                                  ? "movement-in"
                                  : "movement-out"
                              }
                            >
                              {row.quantity > 0 ? "+" : ""}
                              {quantity(row.quantity)} pairs
                            </strong>
                          </td>
                          <td>{row.reason}</td>
                          <td>{row.actorName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="branch-movement-pagination">
                  <span>{history.data.total.toLocaleString()} records</span>
                  <div>
                    <button
                      className="button secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {history.data.page} of{" "}
                      {Math.max(
                        1,
                        Math.ceil(history.data.total / history.data.pageSize),
                      )}
                    </span>
                    <button
                      className="button secondary"
                      disabled={
                        page * history.data.pageSize >= history.data.total
                      }
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="branch-movement-empty">
                <ClipboardList size={26} aria-hidden="true" />
                <h3>No received physical stock yet</h3>
                <p>
                  Confirmed incoming stock movements will appear here after
                  receipt.
                </p>
              </div>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
