"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import type { Viewer } from "@/lib/domain";
import type { TakeoverReportPage } from "@/lib/stock-planning";

async function readTakeovers(page: number, signal?: AbortSignal) {
  const response = await fetch(
    `/api/stock-planning?view=takeovers&page=${page}`,
    { cache: "no-store", signal },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Unable to load takeover history.");
  return body.data as TakeoverReportPage;
}

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Yangon",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";

export function TakeoverReport({
  viewer,
  openOrder,
}: {
  viewer: Viewer;
  openOrder: (id: string) => Promise<void> | void;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["takeover-report", viewer.id, page],
    queryFn: ({ signal }) => readTakeovers(page, signal),
    enabled: viewer.role === "hq",
    retry: false,
  });
  if (viewer.role !== "hq") return null;
  return (
    <section className="panel report-detail takeover-report">
      <div className="panel-heading">
        <div>
          <h2>Takeover history</h2>
          <p className="muted">
            Branch emergency fulfilment records across wholesale orders.
          </p>
        </div>
        <span className="muted">
          {query.data ? `${query.data.total.toLocaleString()} records` : "All branches"}
        </span>
      </div>
      {query.isPending ? (
        <p className="info-pad" role="status">Loading takeover history…</p>
      ) : query.isError ? (
        <div className="info-pad" role="alert">
          <p>Takeover history could not load. {query.error.message}</p>
          <button className="button secondary" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      ) : query.data?.rows.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Wholesale order</th>
                  <th>Branch</th>
                  <th>Product / SKU</th>
                  <th>Pairs</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((row) => (
                  <tr key={`${row.id}:${row.productId}`}>
                    <td>{date(row.at)}</td>
                    <td>
                      <button className="text-link" onClick={() => void openOrder(row.orderId)}>
                        {row.reference}
                      </button>
                    </td>
                    <td>{row.branchName}</td>
                    <td>{row.variant}</td>
                    <td>{row.quantity.toLocaleString()} {row.unit}</td>
                    <td><span className="backup-status unset">{row.status}</span></td>
                    <td>{row.reason}</td>
                    <td>{row.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="takeover-report-footer">
            <span>Page {query.data.page} of {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}</span>
            <div>
              <button className="button secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button className="button secondary" disabled={page * query.data.pageSize >= query.data.total} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
          <details className="takeover-report-audit">
            <summary><ClipboardList size={16} aria-hidden="true" /> Show audit trail for this page</summary>
            {query.data.rows.map((row) => (
              <article key={`${row.id}:${row.productId}`}>
                <strong>{row.reference} · {row.branchName} · {row.variant}</strong>
                <p>Original consignment: {row.resolution}</p>
                <p>Deadline: {date(row.deadline)} · Fulfilled: {date(row.fulfilledAt)}</p>
                {row.responseReason && <p>Branch response: {row.responseReason}</p>}
                {row.events.map((event, index) => (
                  <p key={`${row.id}:${index}`}>{event.action} · {event.actor} · {date(event.at)}{event.reason && ` · ${event.reason}`}</p>
                ))}
              </article>
            ))}
          </details>
        </>
      ) : (
        <div className="takeover-report-empty">
          <ClipboardList size={25} aria-hidden="true" />
          <strong>No takeover history yet</strong>
          <span>Branch emergency fulfilment records will appear here.</span>
        </div>
      )}
    </section>
  );
}
