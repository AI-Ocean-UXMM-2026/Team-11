import "server-only";
import { redirect } from "next/navigation";
import { isDemoMode } from "./supabase/config";
import { getDemoSession } from "./auth/session";
import { portalHome, portalLogin } from "./portals";
import {
  PasswordChangeRequired,
  workflowActor,
  workflowSnapshot,
} from "./workflow/server";
import type { Role } from "./domain";

export async function loadWorkspace(
  _requestedRole?: string,
  requiredRole?: Role,
) {
  if (isDemoMode()) {
    const session = await getDemoSession();
    if (!session) redirect(portalLogin(requiredRole ?? "hq"));
    if (session.mustChangePassword)
      redirect(`/change-password?portal=${session.role}`);
  } else if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    redirect("/setup");
  const viewer = await workflowActor().catch((error: unknown) => {
    if (error instanceof PasswordChangeRequired)
      redirect(`/change-password?portal=${error.role}`);
    return null;
  });
  if (!viewer) redirect(portalLogin(requiredRole ?? "hq"));
  if (requiredRole && viewer.role !== requiredRole)
    redirect(portalHome(viewer.role));
  const data = await workflowSnapshot(viewer);
  if (viewer.role === "branch") viewer.branchId = data.branches[0]?.id;
  return { data, viewer, demo: isDemoMode() };
}
