import "server-only";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest } from "./local";
import { WorkflowError } from "./server";
import type { Viewer } from "../domain";

export interface BranchStockMovement {
  id: number;
  branchId: string;
  branchName: string;
  productId: string;
  variant: string;
  kind: string;
  quantity: number;
  reason: string;
  actorName: string;
  createdAt: string;
}

export interface BranchStockMovementPage {
  rows: BranchStockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export async function branchStockMovementHistory(
  actor: Viewer,
  branchId: string | null,
  page: number,
): Promise<BranchStockMovementPage> {
  if (actor.role !== "branch" || !actor.branchId || branchId !== actor.branchId)
    throw new WorkflowError(
      "You can only view stock movement records for your own branch.",
      403,
    );
  if (!Number.isInteger(page) || page < 1 || page > 1000000)
    throw new WorkflowError("Choose a valid record page.");
  if (isDemoMode()) {
    return localRequest(
      actor.id,
      async (tx) =>
        (
          await tx.query<{ result: BranchStockMovementPage }>(
            "select public.branch_stock_movement_history($1::uuid,$2::integer,25) result",
            [branchId, page],
          )
        ).rows[0].result,
    );
  }
  const { data, error } = await (
    await createClient()
  ).rpc("branch_stock_movement_history", {
    p_branch: branchId,
    p_page: page,
    p_page_size: 25,
  });
  if (error)
    throw new WorkflowError(
      error.code === "P0002" ? "Branch not found." : error.message,
      error.code === "P0002" ? 404 : 400,
    );
  return data as BranchStockMovementPage;
}

