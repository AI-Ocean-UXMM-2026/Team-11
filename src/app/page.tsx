import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const query = await searchParams;
  return <WorkspacePage section="overview" role={query.role} />;
}
