"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PageInfo } from "@/lib/workflow/query";

export function Pagination({
  info,
  label,
  busy = false,
  change,
}: {
  info?: PageInfo;
  label: string;
  busy?: boolean;
  change: (page: number, pageSize: 25 | 50 | 100) => void;
}) {
  if (!info) return null;
  const { page, pageSize, total } = info;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      className="pagination"
      aria-label={`${label} pagination`}
      aria-busy={busy}
    >
      <span role="status" aria-live="polite">
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`
          : "0"}{" "}
        of {total.toLocaleString()} {label.toLowerCase()}
      </span>
      <div className="pagination-controls">
        <label>
          Rows{" "}
          <select
            aria-label={`${label} per page`}
            value={pageSize}
            disabled={busy}
            onChange={(e) => change(1, Number(e.target.value) as 25 | 50 | 100)}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="pagination-pages">
          <button
            type="button"
            className="button secondary"
            aria-label={`Previous ${label.toLowerCase()} page`}
            disabled={busy || page <= 1}
            onClick={() => change(page - 1, pageSize as 25 | 50 | 100)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Previous
          </button>
          <span className="pagination-page-number">
            Page {page} of {pages.toLocaleString()}
          </span>
          <button
            type="button"
            className="button secondary"
            aria-label={`Next ${label.toLowerCase()} page`}
            disabled={busy || page >= pages}
            onClick={() => change(page + 1, pageSize as 25 | 50 | 100)}
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
