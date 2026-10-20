import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { isDemoMode } from "./supabase/config";
import { demoForRole, demoViewer } from "./demo-data";
import { getDemoSession } from "./auth/session";
import { demoDirectory } from "./auth/demo-directory";
import { portalHome, portalLogin } from "./portals";
import {
  businessDate,
  roles,
  type Role,
  type Viewer,
  type WorkspaceData,
} from "./domain";

export async function loadWorkspace(
  requestedRole?: string,
  requiredRole?: Role,
) {
  if (isDemoMode()) {
    const session = await getDemoSession();
    if (requiredRole && !session) redirect(portalLogin(requiredRole));
    if (session && requiredRole && session.role !== requiredRole)
      redirect(portalHome(session.role));
    if (session?.mustChangePassword)
      redirect(`/change-password?portal=${session.role}`);
    const role: Role =
      session?.role ??
      (roles.includes(requestedRole as Role) ? (requestedRole as Role) : "hq");
    if (!session && (role === "sme" || role === "driver"))
      redirect(portalLogin(role));
    const data = demoForRole(role);
    if (role === "hq") data.accounts = demoDirectory().listAccounts();
    if (session && !["demo-sme", "demo-driver", "demo-hq"].includes(session.id))
      data.orders = [];
    return {
      data,
      viewer: {
        ...demoViewer(role),
        ...(session ? { id: session.id, name: session.name } : {}),
        authenticated: !!session,
      },
      demo: true,
    };
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    redirect("/setup");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(requiredRole ? portalLogin(requiredRole) : "/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, name, role, branch_id, status, must_change_password")
    .eq("id", user.id)
    .single();
  if (error || !profile || profile.status !== "active")
    redirect(
      `${requiredRole ? portalLogin(requiredRole) : "/login"}?error=inactive`,
    );
  if (requiredRole && profile.role !== requiredRole)
    redirect(portalHome(profile.role));
  if (profile.must_change_password) redirect("/change-password");
  const viewer: Viewer = {
    id: user.id,
    name: profile.name,
    role: profile.role,
    branchId: profile.branch_id,
    authenticated: true,
  };
  const [orders, products, branches, accounts, inventory] = await Promise.all([
    viewer.role === "driver"
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("orders")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
    viewer.role === "driver"
      ? Promise.resolve({ data: [], error: null })
      : db.from("products").select("*").eq("brand", "STT").eq("active", true),
    viewer.role === "driver"
      ? Promise.resolve({ data: [], error: null })
      : db.from("branches").select("*").eq("active", true),
    viewer.role === "hq"
      ? db.from("profiles").select("id, name, username, role, status, address")
      : Promise.resolve({ data: [], error: null }),
    viewer.role === "hq"
      ? db
          .from("inventory")
          .select("product_id,on_hand,protected_reserve,allocated")
          .is("branch_id", null)
      : viewer.role === "branch"
        ? db
            .from("inventory")
            .select("product_id,on_hand,protected_reserve,allocated")
            .eq("branch_id", viewer.branchId)
        : Promise.resolve({ data: [], error: null }),
  ]);
  if ([orders, products, branches, accounts, inventory].some((r) => r.error))
    throw new Error(
      "Unable to load workspace. Check the Supabase migration and access policies.",
    );
  const data: WorkspaceData = {
    retailSales: [],
    orders: (orders.data ?? []).map((o) => ({
      id: o.id,
      reference: o.reference,
      business: o.business_name,
      initials: o.business_name
        .split(" ")
        .slice(0, 2)
        .map((s: string) => s[0])
        .join(""),
      location: o.destination,
      items: o.item_count,
      merchandise: Number(o.merchandise_total),
      shipping: Number(o.shipping_total),
      status: o.status,
      date: businessDate(o.created_at),
      salesDate: o.done_at ? businessDate(o.done_at) : undefined,
      source: o.source_name,
    })),
    products: (products.data ?? []).map((p) => {
      const stock = inventory.data?.find((i) => i.product_id === p.id);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        pack: p.pack,
        price: Number(p.wholesale_price),
        stock:
          viewer.role === "sme" ? p.available_packs : (stock?.on_hand ?? 0),
        reserve: (stock?.protected_reserve ?? 0) + (stock?.allocated ?? 0),
        minimum: p.minimum_packs,
        tone: p.tone,
        brand: p.brand,
        size: p.size,
        color: p.color,
      };
    }),
    branches: (branches.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      manager: b.manager_name,
      sales: 0,
      stock: 0,
      lowStock: 0,
    })),
    accounts: (accounts.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      username: a.username,
      role: a.role,
      status: a.status === "active" ? "Active" : "Suspended",
      affiliation: a.address,
    })),
  };
  return { data, viewer, demo: false };
}
