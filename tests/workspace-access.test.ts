import { beforeEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));
vi.mock("../src/lib/supabase/config", () => ({ isDemoMode: () => false }));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
import {
  workflowActor,
  PasswordChangeRequired,
} from "../src/lib/workflow/server";
import { loadWorkspace } from "../src/lib/workspace";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  mocks.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "hq-id" } } });
  mocks.single.mockReset().mockResolvedValue({
    data: {
      id: "hq-id",
      name: "HQ",
      role: "hq",
      status: "active",
      must_change_password: true,
    },
    error: null,
  });
});
it("keeps first-login users out of operational actions", async () => {
  await expect(workflowActor()).rejects.toBeInstanceOf(PasswordChangeRequired);
});
it("direct workspace access sends a verified first-login user to password change", async () => {
  await expect(loadWorkspace()).rejects.toThrow(
    "REDIRECT:/change-password?portal=hq",
  );
});
it("does not treat a suspended profile as a valid setup session", async () => {
  mocks.single.mockResolvedValue({
    data: { role: "hq", status: "suspended", must_change_password: true },
    error: null,
  });
  await expect(loadWorkspace()).rejects.toThrow("REDIRECT:/hq/login");
});
it("accepts only a completed active profile as an operational viewer", async () => {
  mocks.single.mockResolvedValue({
    data: {
      id: "hq-id",
      name: "HQ",
      role: "hq",
      status: "active",
      must_change_password: false,
    },
    error: null,
  });
  expect(await workflowActor()).toMatchObject({
    id: "hq-id",
    role: "hq",
    authenticated: true,
  });
});
