import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoMode, supabaseConfig } from "../src/lib/supabase/config";
afterEach(() => vi.unstubAllEnvs());
describe("demo and live separation", () => {
  it("fails closed in production without credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(isDemoMode()).toBe(false);
    expect(() => supabaseConfig()).toThrow();
  });
  it("allows a local preview without credentials", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(isDemoMode()).toBe(true);
  });
  it("honours explicit live mode during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(isDemoMode()).toBe(false);
  });
  it("requires explicit demo opt-in for a hosted demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });
});
