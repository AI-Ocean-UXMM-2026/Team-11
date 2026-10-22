import "server-only";
import { randomUUID } from "node:crypto";
import { getDemoSession } from "../auth/session";
import { isDemoMode } from "../supabase/config";
import { createClient } from "../supabase/server";
import { localRequest, localIdentity } from "./local";
import { notifyDemoTracking } from "./tracking-events";
import type { Role, Viewer, WorkspaceData } from "../domain";
import {
  workspaceQuerySchema,
  type WorkspaceQuery,
  type ListKind,
  type ListPage,
} from "./query";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class PasswordChangeRequired extends WorkflowError {
  constructor(public role: Role) {
    super("Complete your first-login password change before continuing.", 403);
  }
}
export async function workflowActor(): Promise<Viewer> {
  if (isDemoMode()) {
    const user = await getDemoSession();
    if (!user)
      throw new WorkflowError(
        "Sign in and complete your password change.",
        401,
      );
    if (user.mustChangePassword) throw new PasswordChangeRequired(user.role);
    const profile = await localRequest(
      user.id,
      async (tx) =>
        (
          await tx.query<{ status: string; branch_id: string | null }>(
            "select status,branch_id from public.profiles where id=auth.uid()",
          )
        ).rows[0],
    );
    if (!profile || profile.status !== "active")
      throw new WorkflowError("This account or branch is inactive.", 403);
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      authenticated: true,
      branchId: profile.branch_id,
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
  if (error || !p || p.status !== "active")
    throw new WorkflowError(
      "An active account with completed setup is required.",
      403,
    );
  if (p.must_change_password) throw new PasswordChangeRequired(p.role);
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
  attemptId?: string;
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
  if (isDemoMode()) {
    const result = await localRequest(actor.id, async (tx) => {
      const { rows } = await tx.query<{ result: WorkflowResult }>(
        "select public.workflow_execute($1,$2::jsonb,$3::uuid) as result",
        [action, JSON.stringify(payload), key],
      );
      return rows[0].result;
    });
    // Lifecycle changes can remove an earlier anonymous stop from sibling routes.
    notifyDemoTracking();
    return result;
  }
  const db = await createClient();
  const { data, error } = await db.rpc("workflow_execute", {
    p_action: action,
    p_payload: payload,
    p_key: key,
  });
  if (error) throw new WorkflowError(error.message);
  return data;
}
export function parseWorkspaceQuery(input: unknown = {}): WorkspaceQuery {
  const result = workspaceQuerySchema.safeParse(input);
  if (!result.success)
    throw new WorkflowError("Invalid page or filter selection.");
  return result.data;
}
export async function workflowList(
  actor: Viewer,
  kind: ListKind,
  query: WorkspaceQuery,
  page: number,
): Promise<ListPage> {
  const parameters = { ...parseWorkspaceQuery(query), page };
  if (isDemoMode())
    return localRequest(actor.id, async (tx) => {
      const { rows } = await tx.query<{ result: ListPage }>(
        "select public.workflow_list($1,$2::jsonb) as result",
        [kind, JSON.stringify(parameters)],
      );
      return rows[0].result;
    });
  const db = await createClient();
  const { data, error } = await db.rpc("workflow_list", {
    p_kind: kind,
    p_query: parameters,
  });
  if (error) throw new WorkflowError(error.message);
  return data;
}
export async function workflowSnapshot(
  actor: Viewer,
  input: WorkspaceQuery = {},
): Promise<WorkspaceData> {
  const query = parseWorkspaceQuery(input);
  if (isDemoMode())
    return localRequest(actor.id, async (tx) => {
      const { rows } = await tx.query<{ result: WorkspaceData }>(
        "select public.workflow_snapshot($1::jsonb) as result",
        [JSON.stringify(query)],
      );
      return rows[0].result;
    });
  const db = await createClient();
  const { data, error } = await db.rpc("workflow_snapshot", { p_query: query });
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
