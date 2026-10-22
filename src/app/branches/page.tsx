import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default function Page() {
  return <WorkspacePage section="branches" requiredRole="hq" />;
}
