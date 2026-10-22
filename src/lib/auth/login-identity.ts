import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { LoginPortal } from "../portals";

/** Resolve a name privately; never expose profile search to unauthenticated clients. */
export async function resolveLoginUsername(
  portal: LoginPortal,
  identifier: string,
): Promise<string | null> {
  const normalized = identifier.trim().toLowerCase();
  // Generated IDs are already unambiguous and need no directory lookup.
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(normalized))
    return normalized;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalized) ? normalized : null;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Existing account IDs take precedence over a matching display name.
  const exact = await admin
    .from("profiles")
    .select("username")
    .eq("username", normalized)
    .limit(1);
  if (exact.error) return null;
  if (exact.data?.length) return exact.data[0].username;
  // Escape LIKE metacharacters so names are literal, case-insensitive matches.
  const pattern = normalized.replace(/[\\%_]/g, "\\$&");
  const matches = await admin
    .from("profiles")
    .select("username")
    .eq("role", portal)
    .ilike("name", pattern)
    .limit(2);
  if (matches.error || matches.data?.length !== 1) return null;
  return matches.data[0].username;
}
