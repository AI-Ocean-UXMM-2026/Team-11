import Link from "next/link";
import { Boxes } from "lucide-react";
import { ShoeArt } from "./shoe-art";
import type { LoginPortal } from "@/lib/portals";
export function AuthLayout({
  children,
  portal,
}: {
  children: React.ReactNode;
  portal?: LoginPortal;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Boxes size={25} />
          </span>
          Supply<span className="brand-light">Link</span>
        </Link>
        <div>
          <h2 className="auth-slogan">
            One brand.
            <br />
            Every next step.
          </h2>
          <p>
            STT shoes. From our stockroom to your storefront, with every pair
            accounted for.
          </p>
          <div className="auth-shoe-stage">
            <ShoeArt color={portal === "driver" ? "Black" : "White"} />
            <span>STT Everyday sneaker · Exclusive supplier</span>
          </div>
        </div>
        <small>STT footwear network · Yangon, Myanmar</small>
      </section>
      <section className="auth-content">{children}</section>
    </main>
  );
}
