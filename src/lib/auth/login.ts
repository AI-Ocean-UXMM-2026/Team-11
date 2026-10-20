import "server-only";
import { cookies } from "next/headers";
import { createClient } from "../supabase/server";
import { isDemoMode } from "../supabase/config";
import { loginEmail, type Role } from "../domain";
import { loginSchema, portalHome, type LoginPortal } from "../portals";
import { demoDirectory } from "./demo-directory";
import { DEMO_COOKIE } from "./session";

export async function authenticatePortal(
  portal: LoginPortal,
  input: unknown,
): Promise<{ status: number; error?: string; redirectTo?: string }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 400,
      error: "Enter your HQ-issued account ID and password.",
    };
  const { username, password } = parsed.data;
  if (isDemoMode()) {
    const result = demoDirectory().authenticate(portal, username, password);
    if (result.error || !result.token || !result.user)
      return { status: result.status, error: result.error };
    const jar = await cookies();
    const previous = jar.get(DEMO_COOKIE)?.value;
    demoDirectory().signOut(previous);
    jar.set(DEMO_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return {
      status: 200,
      redirectTo: result.user.mustChangePassword
        ? `/change-password?portal=${portal}`
        : portalHome(result.user.role),
    };
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return {
      status: 503,
      error: "Supabase is not configured. Contact HQ to connect the workspace.",
    };
  const db = await createClient();
  const { data, error } = await db.auth.signInWithPassword({
    email: loginEmail(username),
    password,
  });
  if (error || !data.user)
    return {
      status: 401,
      error:
        "These credentials do not match an active account in this portal. Contact HQ if you need access.",
    };
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("role,status,must_change_password")
    .eq("id", data.user.id)
    .single();
  if (
    profileError ||
    !profile ||
    profile.role !== portal ||
    profile.status !== "active"
  ) {
    await db.auth.signOut();
    return {
      status: 403,
      error:
        "These credentials do not match an active account in this portal. Contact HQ if you need access.",
    };
  }
  return {
    status: 200,
    redirectTo: profile.must_change_password
      ? `/change-password?portal=${portal}`
      : portalHome(profile.role as Role),
  };
}
