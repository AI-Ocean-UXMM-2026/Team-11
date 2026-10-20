import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
}));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    from: mocks.from,
  }),
}));
vi.mock("../src/lib/supabase/config", () => ({ isDemoMode: () => false }));
import { authenticatePortal } from "../src/lib/auth/login";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  mocks.signIn
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.single.mockReset().mockResolvedValue({
    data: { role: "sme", status: "active", must_change_password: false },
    error: null,
  });
  mocks.from.mockReset().mockReturnValue({
    select: () => ({ eq: () => ({ single: mocks.single }) }),
  });
});
describe("live portal authorisation", () => {
  it("uses the active server profile to enter the matching portal", async () => {
    expect(
      await authenticatePortal("sme", {
        username: "example",
        password: "test-password",
      }),
    ).toEqual({ status: 200, redirectTo: "/sme" });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: "example@login.supplylink.invalid",
      password: "test-password",
    });
  });
  it("clears the new session when credentials belong to another portal", async () => {
    const result = await authenticatePortal("driver", {
      username: "example",
      password: "test-password",
    });
    expect(result.status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("rejects suspended profiles even after successful password authentication", async () => {
    mocks.single.mockResolvedValue({
      data: { role: "driver", status: "suspended" },
      error: null,
    });
    expect(
      (
        await authenticatePortal("driver", {
          username: "example",
          password: "test-password",
        })
      ).status,
    ).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("routes first-login users to password change before their workspace", async () => {
    mocks.single.mockResolvedValue({
      data: { role: "driver", status: "active", must_change_password: true },
      error: null,
    });
    expect(
      (
        await authenticatePortal("driver", {
          username: "example",
          password: "test-password",
        })
      ).redirectTo,
    ).toBe("/change-password?portal=driver");
  });
  it("rejects malformed IDs before contacting Auth", async () => {
    expect(
      (
        await authenticatePortal("sme", {
          username: "invalid@example.com",
          password: "test",
        })
      ).status,
    ).toBe(400);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
