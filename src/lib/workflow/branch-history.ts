import "server-only";
import { z } from "zod";
import type { Viewer } from "../domain";
import type { BranchHistory } from "../branch-history";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest } from "./local";
import { WorkflowError } from "./server";
export async function branchHistory(
  actor: Viewer,
  branchId: string,
  page: number,
  pageSize: number,
): Promise<BranchHistory> {
  if (actor.role !== "hq")
    throw new WorkflowError("Branch management is restricted to HQ.", 403);
  if (
    !z.uuid().safeParse(branchId).success ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    ![25, 50, 100].includes(pageSize)
  )
    throw new WorkflowError("Invalid branch or history page.");
  if (isDemoMode()) {
    try {
      return await localRequest(
        actor.id,
        async (tx) =>
          (
            await tx.query<{ result: BranchHistory }>(
              "select public.branch_transfer_history($1::uuid,$2::integer,$3::integer) result",
              [branchId, page, pageSize],
            )
          ).rows[0].result,
      );
    } catch {
      throw new WorkflowError("Unable to load branch history. Retry.", 500);
    }
  }
  const { data, error } = await (
    await createClient()
  ).rpc("branch_transfer_history", {
    p_branch: branchId,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error)
    throw new WorkflowError(
      error.code === "P0002"
        ? "Branch not found."
        : "Unable to load branch history. Retry.",
      error.code === "P0002" ? 404 : 500,
    );
  return data;
}
