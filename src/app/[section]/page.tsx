import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { section } = await params;
  const { role } = await searchParams;
  if (
    ![
      "orders",
      "inventory",
      "branches",
      "accounts",
      "reports",
      "settings",
      "catalog",
      "locations",
      "sales",
      "deliveries",
      "help",
    ].includes(section)
  )
    notFound();
  return <WorkspacePage section={section} role={role} />;
}
