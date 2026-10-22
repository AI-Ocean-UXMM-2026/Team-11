"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Viewer } from "@/lib/domain";
import { DeliveryTracking } from "./delivery-tracking";
import { BrandLogo } from "./brand-logo";

export function DriverDeliveryScreen({
  viewer,
  demo,
  orderId,
  origin = "deliveries",
}: {
  viewer: Viewer;
  demo: boolean;
  orderId: string;
  origin?: "overview" | "deliveries";
}) {
  const backHref = `${origin === "overview" ? "/driver" : "/driver/deliveries"}?order=${encodeURIComponent(orderId)}`;
  return (
    <main className="driver-delivery-screen" id="main">
      <header className="delivery-screen-header">
        <Link href={backHref} className="text-link">
          <ArrowLeft size={18} /> Back to order
        </Link>
        <Link href="/driver" className="delivery-screen-brand">
          <BrandLogo className="brand-logo" />
        </Link>
      </header>
      <div className="delivery-screen-title">
        <span className="eyebrow">
          {demo ? "DEMO NAVIGATION" : "DRIVER NAVIGATION"}
        </span>
        <h1>Delivery route</h1>
        <p>Road directions and live location.</p>
      </div>
      <div className="panel delivery-navigation-panel">
        <DeliveryTracking
          key={orderId}
          orderId={orderId}
          viewer={viewer}
          demo={demo}
          focused
          refresh={async () => {}}
        />
      </div>
    </main>
  );
}
