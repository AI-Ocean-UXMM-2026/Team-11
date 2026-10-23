import Link from "next/link";
import {
  Store,
  Truck,
  Building2,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
export default function Login() {
  return (
    <AuthLayout>
      <div className="portal-picker">
        <span className="auth-brand-label">Oceanpride Longyi supplier</span>
        <h1>Your work starts here.</h1>
        <p>
          Choose your portal and use the credentials provided by headquarters.
        </p>
        {[
          {
            role: "sme",
            title: "SME portal",
            text: "Browse Oceanpride Longyi, place orders and track deliveries.",
            icon: Store,
          },
          {
            role: "driver",
            title: "Driver portal",
            text: "View assigned deliveries and handover details.",
            icon: Truck,
          },
          {
            role: "branch",
            title: "Branch portal",
            text: "Manage branch stock, retail sales and assigned deliveries.",
            icon: Building2,
          },
          {
            role: "hq",
            title: "Headquarters",
            text: "Manage stock, branches and issue login accounts.",
            icon: ShieldCheck,
          },
        ].map((p) => (
          <Link
            href={`/${p.role}/login`}
            className="portal-choice"
            key={p.role}
          >
            <p.icon size={24} />
            <span>
              <strong>{p.title}</strong>
              <small>{p.text}</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        ))}
        <small>
          Accounts are created by HQ. Public sign-up is unavailable.
        </small>
      </div>
    </AuthLayout>
  );
}
