import { loadWorkspace } from "@/lib/workspace";
import { canAccess } from "@/lib/domain";
import { redirect } from "next/navigation";
import { Workspace } from "./workspace";
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
  return <Workspace key={result.viewer.role} {...result} section={section} />;
}
