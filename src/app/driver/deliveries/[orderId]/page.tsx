import { notFound } from "next/navigation";
import { z } from "zod";
import { loadWorkspace } from "@/lib/workspace";
import { WorkspaceQueryProvider } from "@/components/workspace-query-provider";
import { DriverDeliveryScreen } from "@/components/driver-delivery-screen";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const result = await loadWorkspace(undefined, "driver", { orderId });
  if (!result.data.selectedOrder) notFound();
  const origin =
    (await searchParams).from === "overview" ? "overview" : "deliveries";
  return (
    <WorkspaceQueryProvider key={`${result.viewer.id}:${result.demo}`}>
      <DriverDeliveryScreen
        viewer={result.viewer}
        demo={result.demo}
        orderId={orderId}
        origin={origin}
      />
    </WorkspaceQueryProvider>
  );
}
