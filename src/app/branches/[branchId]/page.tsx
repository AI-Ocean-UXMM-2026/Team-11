import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const { branchId } = await params;
  if (!z.uuid().safeParse(branchId).success) notFound();
  return (
    <WorkspacePage section="branches" requiredRole="hq" branchId={branchId} />
  );
}
