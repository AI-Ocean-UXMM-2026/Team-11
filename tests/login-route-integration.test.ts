import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  single: vi.fn(),
  lookup: vi.fn(),
  eq: vi.fn(),
  ilike: vi.fn(),
}));
vi.mock("../src/lib/supabase/config", () => ({ isDemoMode: () => false }));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const query = { eq: mocks.eq, ilike: mocks.ilike, limit: mocks.lookup };
    mocks.eq.mockReturnValue(query);
    mocks.ilike.mockReturnValue(query);
    return { from: () => ({ select: () => query }) };
  },
}));
import { POST as branchLogin } from "../src/app/api/auth/branch/login/route";
import { POST as hqLogin } from "../src/app/api/auth/hq/login/route";
import { POST as driverLogin } from "../src/app/api/auth/driver/login/route";
import { POST as smeLogin } from "../src/app/api/auth/sme/login/route";
const id = "10000000-0000-4000-8000-000000000001";
function request(portal: string, username: string) {
  return new Request(`http://localhost:3000/api/auth/${portal}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({ username, password: "test-password-only" }),
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-key");
  mocks.signIn
    .mockReset()
    .mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.single.mockReset().mockResolvedValue({
    data: { role: "branch", status: "active", must_change_password: true },
    error: null,
  });
  mocks.lookup
    .mockReset()
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValue({ data: [{ username: id }], error: null });
  mocks.eq.mockReset();
  mocks.ilike.mockReset();
});
it.each([
  { portal: "hq", name: "HQ Administrator", handler: hqLogin, home: "/" },
  {
    portal: "sme",
    name: "Example Longyi Shop",
    handler: smeLogin,
    home: "/sme",
  },
  {
    portal: "driver",
    name: "Example Driver One",
    handler: driverLogin,
    home: "/driver",
  },
  {
    portal: "branch",
    name: "U Hlaing Branch",
    handler: branchLogin,
    home: "/branch",
  },
])(
  "accepts full-name and password through the actual $portal login route",
  async ({ portal, name, handler, home }) => {
    mocks.single.mockResolvedValue({
      data: { role: portal, status: "active", must_change_password: false },
      error: null,
    });
    const response = await handler(
      request(portal, `  ${name.toUpperCase()}  `),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: home });
    expect(mocks.ilike).toHaveBeenCalledWith("name", name.toLowerCase());
    expect(mocks.eq).toHaveBeenCalledWith("role", portal);
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: `${id}@login.supplylink.invalid`,
      password: "test-password-only",
    });
  },
);
it("sends a newly issued branch name to first-login password change", async () => {
  const response = await branchLogin(request("branch", "U Hlaing Branch"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    redirectTo: "/change-password?portal=branch",
  });
});
it("retains UUID ID sign-in through the branch endpoint", async () => {
  const response = await branchLogin(request("branch", id));
  expect(response.status).toBe(200);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("checks the actual password after resolving a full branch name", async () => {
  mocks.signIn.mockResolvedValue({
    data: { user: null },
    error: { message: "Invalid credentials" },
  });
  const response = await branchLogin(request("branch", "U Hlaing Branch"));
  expect(response.status).toBe(401);
  expect(mocks.signIn).toHaveBeenCalledOnce();
});
it("rejects duplicate branch account names without guessing an identity", async () => {
  mocks.lookup
    .mockReset()
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({
      data: [{ username: "one" }, { username: "two" }],
      error: null,
    });
  const response = await branchLogin(request("branch", "Shared Branch Name"));
  expect(response.status).toBe(401);
  expect(mocks.signIn).not.toHaveBeenCalled();
});
