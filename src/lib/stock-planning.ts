import { z } from "zod";

export const GROQ_STOCK_MODEL = "openai/gpt-oss-20b";
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-01$/);
export const planningRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("settings"),
      key: z.uuid(),
      branchId: z.uuid(),
      productId: z.uuid(),
      target: z.number().int().min(0).max(1000000),
      threshold: z.number().int().min(0).max(1000000),
      unit: z
        .string()
        .trim()
        .regex(/^[a-zA-Z][a-zA-Z ]{0,23}$/),
      source: z.enum(["manual", "ai"]).default("manual"),
      reason: z.string().trim().min(3).max(500),
    })
    .refine((v) => v.threshold <= v.target, {
      message: "Alert threshold must be no greater than the target.",
      path: ["threshold"],
    }),
  z.object({
    action: z.literal("refill"),
    key: z.uuid(),
    branchId: z.uuid(),
    productId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("takeover"),
    key: z.uuid(),
    branchId: z.uuid(),
    productId: z.uuid(),
    orderId: z.uuid(),
    deadline: z.iso.datetime(),
    reason: z.string().trim().min(3).max(500),
    originalResolution: z.enum(["returned_to_hq", "lost"]).optional(),
    consignmentResolved: z.boolean().optional(),
    receivedBack: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("cancel_takeover"),
    key: z.uuid(),
    branchId: z.uuid(),
    productId: z.uuid(),
    orderId: z.uuid(),
    handoffId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("dispatch_refill"),
    key: z.uuid(),
    branchId: z.uuid(),
    productId: z.uuid(),
    transferId: z.uuid(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("generate"),
    key: z.uuid(),
    branchId: z.uuid(),
    month: monthSchema,
    buffer: z.number().int().min(0).max(100).default(20),
    minMonths: z.number().int().min(1).max(3).default(3),
    minOrders: z.number().int().min(1).max(100).default(5),
    overrides: z
      .array(
        z.object({
          productId: z.uuid(),
          target: z.number().int().min(0).max(1000000).nullable(),
          retailMove: z.number().int().min(0).max(1000000),
          reason: z.string().trim().max(500),
        }),
      )
      .max(100),
  }),
  z.object({
    action: z.literal("approve"),
    key: z.uuid(),
    planId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("arrival"),
    key: z.uuid(),
    transferId: z.uuid(),
    due: z.iso.date(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("unmet"),
    key: z.uuid(),
    orderId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("explain"),
    planId: z.uuid(),
    regenerate: z.boolean().default(false),
  }),
]);
export interface BackupRecommendation {
  eligible: boolean;
  quantity: number | null;
  from: string;
  to: string;
  completeMonths: number;
  orders: number;
  units: number;
  monthlyAverage: number;
  monthlyVariation: number;
  leadDays: number | null;
  receipts: number;
  minimumMonths: number;
  minimumOrders: number;
  minimumReceipts: number;
}
export interface BackupPlanningRow {
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  variant: string;
  unit: string;
  retail: number;
  available: number;
  reserved: number;
  target: number | null;
  threshold: number | null;
  source: "manual" | "ai";
  low: boolean;
  incoming: number;
  openRefills: number;
  proposedRefill: number | null;
  recommendation: BackupRecommendation;
}
export interface BackupPlanningDetail {
  row: BackupPlanningRow;
  transfers: {
    id: string;
    reference: string;
    quantity: number;
    status: string;
    createdAt: string;
    receivedAt: string | null;
    due: string | null;
  }[];
  takeovers: {
    id: string;
    orderId: string;
    reference: string;
    quantity: number;
    unit: string;
    reason: string;
    resolution: string;
    responseReason: string | null;
    deadline: string | null;
    fulfilledAt: string | null;
    status: string;
    actor: string;
    at: string;
    events: { action: string; reason: string; at: string; actor: string }[];
  }[];
  orders: {
    id: string;
    reference: string;
    quantity: number;
    dispatched: boolean;
    lines: { variant: string; quantity: number }[];
  }[];
}
export interface PlanningRow {
  configuredTarget?: number | null;
  productId: string;
  variant: string;
  onHand: number;
  allocated: number;
  carryover: number;
  retailAvailable: number;
  incoming: number;
  retailUnits: number;
  backupUnits: number;
  backupOrders: number;
  completeMonths: number;
  stockoutDays: number;
  refillLeadDays: number | null;
  baseline: number | null;
  target: number | null;
  manual: boolean;
  retailMove: number;
  reason: string;
  refill: number | null;
}
export interface StockPlan {
  id: string;
  branchId: string;
  month: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  createdAt: string;
  approvedAt: string | null;
  approvalReason: string | null;
  buffer: number;
  minMonths: number;
  minOrders: number;
  rows: PlanningRow[];
  inputs: PlanningRow[];
  explanation: {
    status: "none" | "pending" | "ready" | "failed";
    summary?: string;
    cautions?: string[];
    model?: string;
    provider?: "groq";
    at?: string;
  };
}
export interface PlanningSnapshot {
  month: string;
  historyFrom: string;
  historyTo: string;
  coverageSince: string;
  current: PlanningRow[];
  plans: StockPlan[];
  unmet: {
    orderId: string;
    reference: string;
    reason: string;
    units: number;
  }[];
  incoming: {
    id: string;
    reference: string;
    variant: string;
    quantity: number;
    due: string | null;
  }[];
}
export function nextPlanningMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
}

// Explicit allowlist: no order/customer/branch identifiers, free-text reasons, money or GPS.
export function explanationInput(plan: StockPlan) {
  return {
    month: plan.month,
    safetyBufferPercent: plan.buffer,
    minimumMonths: plan.minMonths,
    minimumOrders: plan.minOrders,
    rows: plan.rows.map((r, index) => ({
      sku: `SKU-${index + 1}`,
      backupUnits: r.backupUnits,
      backupOrders: r.backupOrders,
      retailUnits: r.retailUnits,
      completeMonths: r.completeMonths,
      stockoutDays: r.stockoutDays,
      averageRefillLeadDays: r.refillLeadDays,
      target: r.target,
      manual: r.manual,
      carryover: r.carryover,
      retailReallocation: r.retailMove,
      qualifyingIncoming: r.incoming,
      additionalRefill: r.refill,
    })),
  };
}
