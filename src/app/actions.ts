"use server";
import { randomUUID } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountSchema, loginEmail } from "@/lib/domain";
import { authenticatePortal } from "@/lib/auth/login";
import { DEMO_COOKIE, getDemoSession, getDemoToken } from "@/lib/auth/session";
import { demoDirectory } from "@/lib/auth/demo-directory";
import { generateTemporaryPassword } from "@/lib/auth/credentials";
import { cookies } from "next/headers";
import { loginPortals, portalHome, type LoginPortal } from "@/lib/portals";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode, supabaseConfig } from "@/lib/supabase/config";
import { z } from "zod";
import { locationSchema } from "@/lib/contact";
import { localRequest } from "@/lib/workflow/local";
import {
  parseWorkspaceQuery,
  workflowActor,
  workflowSnapshot,
} from "@/lib/workflow/server";
import type { WorkspaceQuery } from "@/lib/workflow/query";

const smeDeliveryLocationSchema = z.object({
  address: z.string().trim().min(5).max(300),
  pin: locationSchema,
});

export async function signIn(_previous: { error: string }, form: FormData) {
  const portal = String(form.get("portal") ?? "hq") as LoginPortal;
  if (!loginPortals.includes(portal))
    return { error: "Choose a valid portal." };
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const result = await authenticatePortal(portal, { username, password });
  if (result.error) return { error: result.error };
  redirect(result.redirectTo!);
}
export async function signOut() {
  if (isDemoMode()) {
    demoDirectory().signOut(await getDemoToken());
    (await cookies()).delete(DEMO_COOKIE);
  } else {
    const db = await createClient();
    await db.auth.signOut();
  }
  redirect("/login");
}
export async function saveSmeDeliveryLocation(
  input: unknown,
  queryInput: WorkspaceQuery = {},
): Promise<{ error?: string; data?: Awaited<ReturnType<typeof workflowSnapshot>> }> {
  const parsed = smeDeliveryLocationSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: "Enter a full delivery address and choose a map location.",
    };
  try {
    const actor = await workflowActor();
    if (actor.role !== "sme")
      return {
        error: "Only an SME account can update its delivery location.",
      };
    const { address, pin } = parsed.data;
    if (isDemoMode()) {
      await localRequest(actor.id, async (tx) => {
        const { rows } = await tx.query(
          "update public.profiles set address=$1,latitude=$2,longitude=$3 where id=auth.uid() and role='sme' returning id",
          [address, pin.latitude, pin.longitude],
        );
        if (!rows.length)
          throw new Error("Could not save this SME delivery location.");
      });
    } else {
      const db = await createClient();
      const { data, error } = await db
        .from("profiles")
        .update({ address, latitude: pin.latitude, longitude: pin.longitude })
        .eq("id", actor.id)
        .eq("role", "sme")
        .select("id")
        .maybeSingle();
      if (error || !data)
        return {
          error: "Could not save your delivery location. Try again.",
        };
    }
    return { data: await workflowSnapshot(actor, parseWorkspaceQuery(queryInput)) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save your delivery location.",
    };
  }
}
export async function changePassword(
  _previous: { error: string },
  form: FormData,
) {
  const password = String(form.get("password") ?? "");
  if (
    password.length < 12 ||
    password.length > 128 ||
    password !== form.get("confirm")
  )
    return { error: "Use matching passwords of 12–128 characters." };
  if (isDemoMode()) {
    const user = await getDemoSession();
    const result = demoDirectory().changePassword(
      await getDemoToken(),
      password,
    );
    if (result.error) return { error: result.error };
    redirect(portalHome(user!.role));
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await db.auth.updateUser({ password });
  if (error) return { error: error.message };
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  redirect(portalHome(profile?.role ?? "hq"));
}
export async function provisionAccount(input: unknown): Promise<{
  error?: string;
  id?: string;
  username?: string;
  temporaryPassword?: string;
}> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (isDemoMode()) {
    const result = demoDirectory().provision(await getDemoToken(), parsed.data);
    if (!result.error) revalidatePath("/accounts");
    return result;
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const { data: actor } = await db
    .from("profiles")
    .select("role, status, must_change_password")
    .eq("id", user.id)
    .single();
  if (
    actor?.role !== "hq" ||
    actor.status !== "active" ||
    actor.must_change_password
  )
    return { error: "Only active headquarters accounts can create accounts." };
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret)
    return {
      error:
        "HQ account provisioning needs the server-only Supabase service key.",
    };
  const { url } = supabaseConfig();
  const admin = createAdminClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const value = parsed.data;
  const accountId = randomUUID();
  const temporaryPassword = generateTemporaryPassword();
  if (value.branchId) {
    const { data: branch } = await admin
      .from("branches")
      .select("id")
      .eq("id", value.branchId)
      .eq("active", true)
      .single();
    if (!branch)
      return { error: "Choose an open branch before issuing credentials." };
  }
  const { data, error } = await admin.auth.admin.createUser({
    id: accountId,
    email: loginEmail(accountId),
    password: temporaryPassword,
    email_confirm: true,
  });
  if (error || !data.user)
    return {
      error: "Could not create this account. Please try again.",
    };
  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    name: value.name,
    username: accountId,
    role: value.role,
    phone: value.phone,
    address: value.address,
    latitude: value.pin.latitude,
    longitude: value.pin.longitude,
    branch_id: value.role !== "sme" ? value.branchId || null : null,
    created_by: user.id,
    must_change_password: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return {
      error:
        "Account details could not be saved. Check the branch and try again.",
    };
  }
  revalidatePath("/accounts");
  return { id: data.user.id, username: accountId, temporaryPassword };
}
