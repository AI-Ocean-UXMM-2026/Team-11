import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/supabase/config";
import { getDemoSession } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export default async function ChangePassword() {
  if (isDemoMode()) {
    const session = await getDemoSession();
    if (!session) redirect("/login");
    return (
      <AuthLayout>
        <AuthForm change />
      </AuthLayout>
    );
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AuthLayout>
      <AuthForm change />
    </AuthLayout>
  );
}
