import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function BranchPage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return (
    <WorkspacePage section={path?.[0] ?? "overview"} requiredRole="branch" />
  );
}
