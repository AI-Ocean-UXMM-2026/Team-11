import "server-only";
import { randomUUID } from "node:crypto";
import { getDemoSession } from "../auth/session";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest, localIdentity } from "./local";
import type { Viewer, WorkspaceData } from "../domain";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function workflowActor(): Promise<Viewer> {
  if (isDemoMode()) {
    const user = await getDemoSession();
    if (!user || user.mustChangePassword)
      throw new WorkflowError(
        "Sign in and complete your password change.",
        401,
      );
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      authenticated: true,
    };
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new WorkflowError("Sign in again.", 401);
  const { data: p, error } = await db
    .from("profiles")
    .select("id,name,role,branch_id,status,must_change_password")
    .eq("id", user.id)
    .single();
  if (error || !p || p.status !== "active" || p.must_change_password)
    throw new WorkflowError(
      "An active account with completed setup is required.",
      403,
    );
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    branchId: p.branch_id,
    authenticated: true,
  };
}
export type WorkflowResult = {
  message?: string;
  orderId?: string;
  intentId?: string;
  path?: string;
};
export async function executeWorkflow(
  actor: Viewer,
  action: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<WorkflowResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  )
    throw new WorkflowError("A valid retry key is required.");
  if (JSON.stringify(payload).length > 20000)
    throw new WorkflowError("This request is too large.");
  if (isDemoMode())
    return localRequest(actor.id, async (tx) => {
      const { rows } = await tx.query<{ result: WorkflowResult }>(
        "select public.workflow_execute($1,$2::jsonb,$3::uuid) as result",
        [action, JSON.stringify(payload), key],
      );
      return rows[0].result;
    });
  const db = await createClient();
  const { data, error } = await db.rpc("workflow_execute", {
    p_action: action,
    p_payload: payload,
    p_key: key,
  });
  if (error) throw new WorkflowError(error.message);
  return data;
}
export async function workflowSnapshot(actor: Viewer): Promise<WorkspaceData> {
  if (isDemoMode())
    return localRequest(actor.id, async (tx) => {
      const { rows } = await tx.query<{ result: WorkspaceData }>(
        "select public.workflow_snapshot() as result",
      );
      return rows[0].result;
    });
  const db = await createClient();
  const { data, error } = await db.rpc("workflow_snapshot");
  if (error) throw new WorkflowError(error.message);
  return data;
}
export async function readEvidence(
  actor: Viewer,
  orderId: string,
  evidenceId: string,
) {
  return executeWorkflow(
    actor,
    "proof_read",
    { orderId, evidenceId },
    randomUUID(),
  );
}
export { localIdentity };
