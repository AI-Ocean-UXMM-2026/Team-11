import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  profile: vi.fn(),
  createUser: vi.fn(),
  insert: vi.fn(),
  deleteUser: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../src/lib/auth/login", () => ({ authenticatePortal: vi.fn() }));
vi.mock("../src/lib/supabase/config", () => ({
  isDemoMode: () => false,
  supabaseConfig: () => ({ url: "https://test.supabase.co" }),
}));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser },
    },
    from: () => ({ insert: mocks.insert }),
  }),
}));

import { provisionAccount } from "../src/app/actions";

const input = {
  name: "Test store",
  role: "sme",
  phone: "9123456789",
  phoneCountry: "MM",
  address: "12 Hlaing Road, Yangon",
  pin: { latitude: 16.84, longitude: 96.17 },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-key");
  mocks.user.mockResolvedValue({ data: { user: { id: "hq-id" } } });
  mocks.profile.mockResolvedValue({
    data: { role: "hq", status: "active", must_change_password: false },
  });
  mocks.createUser.mockImplementation(async (attributes) => ({
    data: { user: { id: attributes.id } },
    error: null,
  }));
  mocks.insert.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

it("generates credentials on the server and stores the SME address and account location pin", async () => {
  const result = await provisionAccount({
    ...input,
    address: "12 Hlaing Road, Yangon",
    username: "chosen-id",
    password: "chosen-password",
  });
  expect(result.error).toBeUndefined();
  expect(result.temporaryPassword).toHaveLength(28);
  expect(result.temporaryPassword).not.toBe("chosen-password");
  expect(mocks.createUser).toHaveBeenCalledWith({
    id: result.id,
    email: `${result.username}@login.supplylink.invalid`,
    password: result.temporaryPassword,
    email_confirm: true,
  });
  expect(mocks.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      id: result.id,
      username: result.username,
      phone: "+959123456789",
      address: "12 Hlaing Road, Yangon",
      latitude: 16.84,
      longitude: 96.17,
      must_change_password: true,
    }),
  );
  expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty("password");
});

it("requires a map pin and HQ authorization before creating an Auth identity", async () => {
  expect(
    (await provisionAccount({ ...input, pin: undefined })).error,
  ).toBeTruthy();
  mocks.profile.mockResolvedValue({
    data: { role: "sme", status: "active", must_change_password: false },
  });
  expect((await provisionAccount(input)).error).toMatch(/headquarters/);
  expect(mocks.createUser).not.toHaveBeenCalled();
});

it("does not hand over a password when saving the profile fails", async () => {
  mocks.insert.mockResolvedValue({ error: { message: "storage failed" } });
  const result = await provisionAccount(input);
  expect(result.error).toBeTruthy();
  expect(result).not.toHaveProperty("temporaryPassword");
  expect(mocks.deleteUser).toHaveBeenCalledWith(
    mocks.createUser.mock.calls[0][0].id,
  );
});
