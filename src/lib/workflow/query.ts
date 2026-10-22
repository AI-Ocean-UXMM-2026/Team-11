import { z } from "zod";

const page = z.number().int().min(1).max(1000000).optional();
const date = z.iso.date().optional();
export const workspaceQuerySchema = z.object({
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  ordersPage: page,
  retailPage: page,
  transfersPage: page,
  reportPage: page,
  search: z.string().trim().max(120).optional(),
  status: z
    .enum([
      "All orders",
      "Order remaining",
      "Draft",
      "Awaiting verification",
      "Confirmed",
      "Preparing",
      "Shipping",
      "On hold",
      "Complete",
      "Done",
      "Cancelled",
    ])
    .optional(),
  reportFrom: date,
  reportTo: date,
  reportChannel: z.enum(["All channels", "Retail", "Wholesale"]).optional(),
  reportCutoff: z.iso.datetime({ offset: true }).optional(),
  orderId: z.uuid().optional(),
  ordersCutoff: z.iso.datetime({ offset: true }).optional(),
});
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;
export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
}
export type ListKind = "orders" | "retail" | "transfers" | "report";

export interface ListPage extends PageInfo {
  rows: unknown[];
  summary: { wholesale?: number; retail?: number };
  cutoff: string;
}
