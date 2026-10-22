import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  eq: vi.fn(),
  ilike: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
import { resolveLoginUsername } from "../src/lib/auth/login-identity";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-key");
  const query = { eq: mocks.eq, ilike: mocks.ilike, limit: mocks.limit };
  mocks.eq.mockReset().mockReturnValue(query);
  mocks.ilike.mockReset().mockReturnValue(query);
  mocks.limit.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.create
    .mockReset()
    .mockReturnValue({ from: () => ({ select: () => query }) });
});
it("resolves exact case-insensitive names within the requested portal", async () => {
  mocks.limit
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [{ username: "issued-id" }], error: null });
  expect(await resolveLoginUsername("driver", "  Test Driver One  ")).toBe(
    "issued-id",
  );
  expect(mocks.eq).toHaveBeenCalledWith("role", "driver");
  expect(mocks.ilike).toHaveBeenCalledWith("name", "test driver one");
  expect(mocks.create).toHaveBeenCalledWith(
    "https://test.supabase.co",
    "test-server-key",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
});
it("keeps existing IDs authoritative over display-name collisions", async () => {
  mocks.limit.mockResolvedValueOnce({
    data: [{ username: "hq.admin" }],
    error: null,
  });
  expect(await resolveLoginUsername("hq", "HQ.ADMIN")).toBe("hq.admin");
  expect(mocks.ilike).not.toHaveBeenCalled();
});
it("fails closed on duplicate names, missing names and lookup errors", async () => {
  for (const result of [
    { data: [{ username: "one" }, { username: "two" }], error: null },
    { data: [], error: null },
    { data: null, error: { message: "unavailable" } },
  ]) {
    mocks.limit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce(result);
    expect(await resolveLoginUsername("sme", "Shared Store")).toBeNull();
  }
});
it("treats name wildcard characters as literal characters", async () => {
  await resolveLoginUsername("sme", "Shop%_Name");
  expect(mocks.ilike).toHaveBeenCalledWith("name", String.raw`shop\%\_name`);
});
it("accepts generated IDs without a privileged lookup", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  expect(await resolveLoginUsername("branch", id)).toBe(id);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("retains ID sign-in when a deployment has no provisioning key", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect(await resolveLoginUsername("hq", "hq.admin")).toBe("hq.admin");
  expect(await resolveLoginUsername("hq", "Some Full Name")).toBeNull();
});
