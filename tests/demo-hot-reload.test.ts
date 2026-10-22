import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { DemoDirectory } from "../src/lib/auth/demo-directory";
import { DEMO_PASSWORD } from "../src/lib/auth/demo-presets";

const session = vi.hoisted(() => ({ token: "" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/lib/auth/login", () => ({ authenticatePortal: vi.fn() }));
vi.mock("../src/lib/auth/session", () => ({
  getDemoToken: async () => session.token,
  DEMO_COOKIE: "test-demo",
  getDemoSession: vi.fn(),
}));
vi.mock("../src/lib/supabase/config", () => ({
  isDemoMode: () => true,
  supabaseConfig: () => ({ url: "https://test.supabase.co" }),
}));

import { provisionAccount } from "../src/app/actions";
import { demoDirectory } from "../src/lib/auth/demo-directory";

const runtime = globalThis as typeof globalThis & {
  supplylinkDemoDirectory?: DemoDirectory;
};
afterEach(() => {
  delete runtime.supplylinkDemoDirectory;
});

it("uses the current account handler after hot reload without dropping existing sessions", async () => {
  const directory = new DemoDirectory();
  session.token = directory.authenticate(
    "hq",
    "hq.admin",
    DEMO_PASSWORD,
  ).token!;
  // The dev server retained this instance from before password/address inputs
  // were removed. Its old prototype still closes over the old required schema.
  const oldPrototype = Object.create(DemoDirectory.prototype);
  const obsoleteSchema = z.object({
    password: z.string(),
    address: z.string(),
  });
  oldPrototype.provision = (_token: unknown, input: unknown) => {
    const parsed = obsoleteSchema.safeParse(input);
    return {
      error: parsed.success
        ? "obsolete handler"
        : parsed.error.issues[0].message,
    };
  };
  Object.setPrototypeOf(directory, oldPrototype);
  runtime.supplylinkDemoDirectory = directory;

  const result = await provisionAccount({
    name: "gg",
    role: "sme",
    phone: "9211111111",
    phoneCountry: "MM",
    address: "12 Hlaing Road, Yangon",
    branchId: "",
    pin: { latitude: 16.84, longitude: 96.17 },
  });
  expect(result.error).toBeUndefined();
  expect(result.temporaryPassword).toHaveLength(28);
  expect(demoDirectory()).toBe(directory);
  expect(directory.session(session.token)?.role).toBe("hq");
  expect(
    directory.authenticate("sme", result.username!, result.temporaryPassword!)
      .status,
  ).toBe(200);
});
