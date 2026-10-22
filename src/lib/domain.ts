import { z } from "zod";
import { internationalPhone, locationSchema } from "./contact";
import type { PageInfo, WorkspaceQuery } from "./workflow/query";

export const roles = ["hq", "sme", "branch", "driver"] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  hq: "Headquarters",
  sme: "SME portal",
  branch: "Branch portal",
  driver: "Driver portal",
};
export type OrderStatus =
  | "Order remaining"
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
  pin?: { latitude: number; longitude: number } | null;
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
    fulfilment?: {
      deliveryStatus: OrderStatus;
      ordered: number;
      received: number;
      remaining: number;
      current: {
        id: string;
        number: number;
        state: "requested" | "reserved" | "dispatched";
        sourceBranchId: string | null;
        source: string;
        pairs: number;
        received: boolean;
        attemptId: string | null;
        lines: {
          productId: string;
          name: string;
          variant: string;
          quantity: number;
        }[];
      } | null;
      history: {
        id: string;
        number: number;
        source: string;
        state: string;
        pairs: number;
        received: boolean;
        handover: boolean;
        completedAt: string | null;
      }[];
      lines: {
        productId: string;
        name: string;
        variant: string;
        ordered: number;
        received: number;
      }[];
    } | null;
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
    attemptId?: string | null;
    pickedUpAt?: string | null;
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
  sku?: string;
  name: string;
  category: string;
  pack: string;
  price: number;
  stock: number;
  reserve: number;
  minimum: number;
  tone: string;
  imagePath?: string;
  brand: string;
  size: string;
  color: string;
}
export interface Branch {
  id: string;
  pin?: { latitude: number; longitude: number } | null;
  name: string;
  address: string;
  manager: string;
  sales: number;
  stock: number;
  lowStock: number;
  retailStock?: number;
  backupStock?: number;
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
    backupTarget?: number | null;
    backupAllocated?: number;
  }[];
}
export interface Account {
  id: string;
  name: string;
  username: string;
  role: Role;
  status: string;
  affiliation: string;
  address?: string;
  branchId?: string | null;
  branchName?: string;
  phone?: string;
  pin?: { latitude: number; longitude: number } | null;
}
export interface RetailSale {
  id: string;
  branchId: string;
  description: string;
  amount: number;
  packs: number;
  date: string;
}
export interface RefillRequest {
  target?: number | null;
  unit?: string;
  pool?: "on_hand" | "backup";
  id: string;
  branchId: string;
  branchName: string;
  productId: string;
  variant: string;
  onHand: number;
  threshold: number;
  incoming: number;
  createdAt: string;
}
export interface WorkspaceData {
  refillRequests?: RefillRequest[];
  refillRequestCount?: number;
  query?: WorkspaceQuery;
  pagination?: Record<"orders" | "retail" | "transfers" | "report", PageInfo>;
  selectedOrder?: Order | null;
  attentionOrders?: Order[];
  summary?: {
    orders: number;
    active: number;
    awaiting: number;
    held: number;
    shipping: number;
    wholesale: number;
    retail: number;
    retailCount: number;
    pendingTransfers: number;
  };
  report?: { wholesale: number; retail: number; cutoff: string };
  orders: Order[];
  products: Product[];
  branches: Branch[];
  accounts: Account[];
  retailSales: RetailSale[];
  settings?: { shipping: number | null; instructions: string; area: string };
  profile?: {
    phone: string;
    address: string;
    pin: { latitude: number; longitude: number } | null;
  };
  workflowEnabled?: boolean;
  transfers?: {
    purpose?: "retail" | "backup";
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
    role: z.enum(["sme", "driver", "branch"]),
    phone: z.string().trim().min(6).max(30),
    phoneCountry: z.string().default("MM"),
    address: z.string().trim().max(300).default(""),
    pin: locationSchema,
    branchId: z.union([z.literal(""), z.uuid()]).optional(),
  })
  .superRefine((value, context) => {
    if (!internationalPhone(value.phone, value.phoneCountry))
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid phone number for the selected country.",
      });
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
    if (value.role === "sme" && value.address.length < 5)
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "Enter the SME's full delivery address.",
      });
  })
  .transform((value) => ({
    ...value,
    phone: internationalPhone(value.phone, value.phoneCountry)!,
  }));
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
export function money(amount: number) {
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
      "drivers",
      "accounts",
      "reports",
      "stock-planning",
      "settings",
    ],
    sme: ["overview", "catalog", "orders", "locations", "help", "settings"],
    branch: [
      "overview",
      "inventory",
      "stock-movements",
      "sales",
      "reports",
      "settings",
      "deliveries",
    ],
    driver: ["overview", "deliveries", "help", "settings"],
  }[role].includes(section);
}
