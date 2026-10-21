import { loadWorkspace } from "@/lib/workspace";
import { canAccess } from "@/lib/domain";
import { redirect } from "next/navigation";
import { Workspace } from "./workspace";
import { WorkspaceQueryProvider } from "./workspace-query-provider";
import { portalHome } from "@/lib/portals";
import type { Role } from "@/lib/domain";
export async function WorkspacePage({
  section,
  role,
  requiredRole,
}: {
  section: string;
  role?: string;
  requiredRole?: Role;
}) {
  const result = await loadWorkspace(role, requiredRole);
  if (!canAccess(result.viewer.role, section))
    redirect(portalHome(result.viewer.role));
  return (
    <WorkspaceQueryProvider
      key={`${result.viewer.id}:${result.viewer.role}:${result.demo}`}
    >
      <Workspace {...result} section={section} />
    </WorkspaceQueryProvider>
  );
}
