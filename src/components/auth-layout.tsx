import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "./brand-logo";
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand" aria-label="SupplyLink home">
          <BrandLogo className="brand-logo" inverse />
        </Link>
        <h2 className="auth-slogan">
          Wear with PRIDE
          <br />
          like OCEAN
        </h2>
        <div className="auth-product-stage">
          <Image
            src="/brand/ocean-pride-longyi-model.png?cutout=20261023"
            alt="Model wearing an Oceanpride Longyi and presenting its gift set"
            width={853}
            height={1280}
            className="auth-product-image"
            priority
            unoptimized
          />
          <span>Oceanpride Longyi · Wholesale supplier</span>
        </div>
        <small>Oceanpride Longyi network · Yangon, Myanmar</small>
      </section>
      <section className="auth-content">{children}</section>
    </main>
  );
}
