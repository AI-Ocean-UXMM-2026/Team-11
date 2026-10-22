import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ role?: string; branchId?: string }>;
}) {
  const { section } = await params;
  const { role, branchId } = await searchParams;
  if (
    ![
      "orders",
      "inventory",
      "branches",
      "drivers",
      "accounts",
      "reports",
      "stock-planning",
      "settings",
      "catalog",
      "locations",
      "sales",
      "deliveries",
      "help",
    ].includes(section)
  )
    notFound();
  return (
    <WorkspacePage
      section={section}
      role={role}
      planningBranchId={section === "stock-planning" ? branchId : undefined}
    />
  );
}
