import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function SmePortal({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const section = path?.[0] ?? "overview";
  if (
    (path?.length ?? 0) > 1 ||
    ![
      "overview",
      "catalog",
      "orders",
      "locations",
      "help",
      "settings",
    ].includes(section)
  )
    notFound();
  return <WorkspacePage section={section} requiredRole="sme" />;
}
