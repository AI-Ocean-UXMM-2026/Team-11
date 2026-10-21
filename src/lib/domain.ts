import { z } from "zod";

export const roles = ["hq", "sme", "branch", "driver"] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  hq: "Headquarters",
  sme: "SME portal",
  branch: "Branch portal",
  driver: "Driver portal",
};
export type OrderStatus =
  | "Draft"
  | "Awaiting verification"
  | "Confirmed"
  | "Preparing"
  | "Shipping"
  | "On hold"
  | "Complete"
  | "Done"
  | "Cancelled";
export interface Order {
  id: string;
  reference: string;
  business: string;
  initials: string;
  location: string;
  items: number;
  merchandise: number;
  shipping: number;
  status: OrderStatus;
  date: string;
  salesDate?: string;
  source: string;
  workflow?: {
    receiver: string;
    phone: string;
    notes: string;
    paymentVerified: boolean;
    reserved: boolean;
    hqComplete: boolean;
    received: boolean;
    issue: string | null;
    refundRequired: boolean;
    instructions: string;
    driverId: string | null;
    driverName: string | null;
    handover: boolean;
    dispatched?: boolean;
    sourceBranchId?: string | null;
    handoffPending?: boolean;
    replacementRequired?: boolean;
    handoffs?: {
      id: string;
      branchId: string;
      branchName: string;
      status: string;
      resolution: string;
      reason: string;
      responseReason?: string;
      at: string;
    }[];
    lines: {
      productId: string;
      name: string;
      variant: string;
      quantity: number;
      unitPrice?: number;
    }[];
    evidence: {
      id: string;
      version: number;
      amount: number;
      verifiedAmount: number | null;
      reference: string;
      status: string;
      reason: string | null;
      createdAt: string;
    }[];
    events: { action: string; reason: string; at: string; actor: string }[];
  };
}
export interface Product {
  id: string;
  name: string;
  category: string;
  pack: string;
  price: number;
  stock: number;
  reserve: number;
  minimum: number;
  tone: string;
  brand: string;
  size: string;
  color: string;
}
export interface Branch {
  id: string;
  name: string;
  address: string;
  manager: string;
  sales: number;
  stock: number;
  lowStock: number;
  active?: boolean;
  closedAt?: string | null;
  driverCount?: number;
  staffCount?: number;
  inventory?: {
    productId: string;
    variant: string;
    onHand: number;
    allocated: number;
    protected: number;
  }[];
}
export interface Account {
  id: string;
  name: string;
  username: string;
  role: Role;
  status: string;
  affiliation: string;
  branchId?: string | null;
  branchName?: string;
}
export interface RetailSale {
  id: string;
  branchId: string;
  description: string;
  amount: number;
  packs: number;
  date: string;
}
export interface WorkspaceData {
  orders: Order[];
  products: Product[];
  branches: Branch[];
  accounts: Account[];
  retailSales: RetailSale[];
  settings?: { shipping: number | null; instructions: string; area: string };
  workflowEnabled?: boolean;
  transfers?: {
    id: string;
    reference: string;
    sourceBranchId: string | null;
    destinationBranchId: string | null;
    source: string;
    destination: string;
    productId: string;
    variant: string;
    quantity: number;
    status: string;
    reason: string;
    createdAt: string;
  }[];
  salesEvents?: {
    id: string;
    reference: string;
    orderId?: string;
    channel: string;
    amount: number;
    units: number;
    branchId?: string;
    date: string;
  }[];
}
export interface Viewer {
  id: string;
  name: string;
  role: Role;
  branchId?: string | null;
  authenticated?: boolean;
}

export const accountSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9][a-z0-9._-]{2,39}$/,
        "Use 3–40 lowercase letters, numbers, dots or hyphens.",
      ),
    role: z.enum(["sme", "driver", "branch"]),
    password: z.string().min(12, "Use at least 12 characters.").max(128),
    phone: z.string().trim().min(6).max(30),
    address: z.string().trim().min(2).max(300),
    branchId: z.union([z.literal(""), z.uuid()]).optional(),
  })
  .superRefine((value, context) => {
    if (value.role === "branch" && !value.branchId)
      context.addIssue({
        code: "custom",
        path: ["branchId"],
        message: "Choose the branch for this staff account.",
      });
    if (value.role === "sme" && value.branchId)
      context.addIssue({
        code: "custom",
        path: ["branchId"],
        message: "SME accounts cannot belong to a supplier branch.",
      });
  });
export function loginEmail(username: string) {
  return `${username.trim().toLowerCase()}@login.supplylink.invalid`;
}
export function businessDate(timestamp: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
export function money(amount: number, compact = false) {
  if (compact && amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    amount,
  );
}
export function merchandiseSales(orders: Order[]) {
  return orders
    .filter((o) => o.status === "Done")
    .reduce((sum, o) => sum + o.merchandise, 0);
}
export function total(order: Order) {
  return order.merchandise + order.shipping;
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^\s*[=+@\-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function ordersCsv(orders: Order[]) {
  return [
    [
      "Order",
      "Business",
      "Status",
      "Merchandise MMK",
      "Shipping MMK",
      "Full total MMK",
      "Date",
      "Source",
    ],
    ...orders.map((o) => [
      o.reference,
      o.business,
      o.status,
      o.merchandise,
      o.shipping,
      total(o),
      o.date,
      o.source,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
export function canAccess(role: Role, section: string) {
  return {
    hq: [
      "overview",
      "orders",
      "inventory",
      "branches",
      "accounts",
      "reports",
      "settings",
    ],
    sme: ["overview", "catalog", "orders", "locations", "help", "settings"],
    branch: [
      "overview",
      "inventory",
      "sales",
      "reports",
      "settings",
      "deliveries",
    ],
    driver: ["overview", "deliveries", "help", "settings"],
  }[role].includes(section);
}
