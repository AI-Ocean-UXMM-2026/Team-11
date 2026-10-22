import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/auth/login", () => ({ authenticatePortal: auth }));
import { portalLoginHandler } from "../src/lib/auth/login-handler";
beforeEach(() => {
  auth.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function request(body: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth/sme/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body,
  });
}
describe("portal login HTTP boundary", () => {
  it("accepts the original Host when the framework uses an internal request URL", async () => {
    auth.mockResolvedValue({ status: 200, redirectTo: "/sme" });
    const req = new Request("http://localhost:3000/api/auth/sme/login", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: '{"username":"example","password":"private"}',
    });
    expect((await portalLoginHandler("sme")(req)).status).toBe(200);
  });
  it("rejects foreign origins and malformed payloads before authentication", async () => {
    const handler = portalLoginHandler("sme");
    expect(
      (await handler(request("{}", "https://elsewhere.example"))).status,
    ).toBe(403);
    expect((await handler(request("{"))).status).toBe(400);
    expect((await handler(request("x".repeat(4097)))).status).toBe(413);
    expect(auth).not.toHaveBeenCalled();
  });
  it("pins the portal at the endpoint and returns no-store responses", async () => {
    auth.mockResolvedValue({ status: 200, redirectTo: "/sme" });
    const response = await portalLoginHandler("sme")(
      request(
        JSON.stringify({
          username: "example",
          password: "private",
          role: "hq",
        }),
      ),
    );
    expect(auth.mock.calls[0][0]).toBe("sme");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ redirectTo: "/sme" });
  });
  it("returns safe failures without reflecting passwords", async () => {
    auth.mockRejectedValue(new Error("do not expose secrets"));
    const response = await portalLoginHandler("driver")(
      request('{"username":"example","password":"private"}'),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secrets");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secrets",
    );
  });
  it("logs only a safe database code and missing relation for startup failures", async () => {
    auth.mockRejectedValue(
      Object.assign(
        new Error(
          'relation "supplylink_private.branch_refill_requests" does not exist',
        ),
        {
          code: "42P01",
          query: "private-password",
          params: ["private-password"],
        },
      ),
    );
    const response = await portalLoginHandler("hq")(
      request('{"username":"hq.admin","password":"private-password"}'),
    );
    expect(response.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith(
      "Portal sign-in failed (hq; 42P01; missing relation supplylink_private.branch_refill_requests)",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private-password",
    );
  });
});
