import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function DriverPortal({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { path } = await params;
  const section = path?.[0] ?? "overview";
  if (
    (path?.length ?? 0) > 1 ||
    !["overview", "deliveries", "help", "settings"].includes(section)
  )
    notFound();
  const order = (await searchParams).order;
  if (order !== undefined && !z.uuid().safeParse(order).success) notFound();
  return (
    <WorkspacePage
      section={section}
      requiredRole="driver"
      restoreOrderId={
        section === "overview" || section === "deliveries"
          ? (order as string | undefined)
          : undefined
      }
    />
  );
}
