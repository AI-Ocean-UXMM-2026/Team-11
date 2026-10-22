import type { Metadata } from "next";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import "@/styles/accessibility.css";
import "@/styles/product-catalog.css";
import { DriverTrackingProvider } from "@/components/driver-tracking-provider";
export const metadata: Metadata = {
  title: "SupplyLink · Your network, connected",
  description:
    "A connected workspace for wholesale orders, branches and deliveries.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <DriverTrackingProvider>{children}</DriverTrackingProvider>
      </body>
    </html>
  );
}
