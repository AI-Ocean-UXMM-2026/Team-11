import { csvCell, type Order, type WorkspaceData } from "../domain";
import type { PageInfo } from "./query";

export interface ExportPage extends PageInfo {
  rows: unknown[];
  summary: { wholesale?: number; retail?: number };
  cutoff: string;
}
const line = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
export async function* exportCsv(
  kind: "orders" | "report",
  first: ExportPage,
  next: (page: number) => Promise<ExportPage>,
  selection: { reportFrom?: string; reportTo?: string; reportChannel?: string },
) {
  yield "\uFEFF";
  if (kind === "report") {
    yield line([
      "SupplyLink merchandise sales",
      "From",
      selection.reportFrom,
      "To",
      selection.reportTo,
      "Channel",
      selection.reportChannel ?? "All channels",
      "Timezone",
      "Asia/Yangon",
      "Currency",
      "MMK",
      "As of",
      first.cutoff,
    ]);
    yield line(["Reference", "Channel", "Date", "Net merchandise MMK"]);
  } else
    yield line([
      "Order",
      "Business",
      "Status",
      "Merchandise MMK",
      "Shipping MMK",
      "Full total MMK",
      "Date",
      "Source",
    ]);
  let batch = first;
  let count = 0;
  for (
    let page = 1;
    page <= Math.max(1, Math.ceil(first.total / first.pageSize));
    page++
  ) {
    if (page > 1) batch = await next(page);
    if (batch.page !== page || batch.total !== first.total)
      throw new Error(
        "Records changed during export. Refresh and export again.",
      );
    for (const row of batch.rows) {
      if (kind === "orders") {
        const o = row as Order;
        yield line([
          o.reference,
          o.business,
          o.status,
          o.merchandise,
          o.shipping,
          o.merchandise + o.shipping,
          o.date,
          o.source,
        ]);
      } else {
        const e = row as NonNullable<WorkspaceData["salesEvents"]>[number];
        yield line([e.reference, e.channel, e.date, e.amount]);
      }
      count++;
    }
  }
  if (count !== first.total)
    throw new Error("The export was incomplete. Refresh and export again.");
  if (kind === "report")
    yield line([
      "Total",
      "",
      "",
      (first.summary.wholesale ?? 0) + (first.summary.retail ?? 0),
    ]);
}
