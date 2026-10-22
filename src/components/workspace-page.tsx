import { loadWorkspace } from "@/lib/workspace";
import { canAccess } from "@/lib/domain";
import { redirect, notFound } from "next/navigation";
import { Workspace } from "./workspace";
import { WorkspaceQueryProvider } from "./workspace-query-provider";
import { portalHome } from "@/lib/portals";
import type { Role } from "@/lib/domain";
export async function WorkspacePage({
  section,
  role,
  requiredRole,
  branchId,
  restoreOrderId,
}: {
  section: string;
  role?: string;
  requiredRole?: Role;
  branchId?: string;
  restoreOrderId?: string;
}) {
  const result = await loadWorkspace(
    role,
    requiredRole,
    restoreOrderId ? { orderId: restoreOrderId } : undefined,
  );
  if (restoreOrderId && !result.data.selectedOrder) notFound();
  if (!canAccess(result.viewer.role, section))
    redirect(portalHome(result.viewer.role));
  if (branchId && !result.data.branches.some((b) => b.id === branchId))
    notFound();
  return (
    <WorkspaceQueryProvider
      key={`${result.viewer.id}:${result.viewer.role}:${result.demo}`}
    >
      <Workspace
        key={branchId ?? `${section}:${restoreOrderId ?? ""}`}
        {...result}
        section={section}
        branchId={branchId}
        restoreOrderId={restoreOrderId}
      />
    </WorkspaceQueryProvider>
  );
}
