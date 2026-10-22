import { AuthForm } from "./auth-form";
import { AuthLayout } from "./auth-layout";
import { isDemoMode } from "@/lib/supabase/config";
import type { LoginPortal } from "@/lib/portals";
export function PortalLoginPage({ portal }: { portal: LoginPortal }) {
  return (
    <AuthLayout>
      <AuthForm portal={portal} demo={isDemoMode()} />
    </AuthLayout>
  );
}
