import { beforeEach, describe, expect, it } from "vitest";
import { DemoDirectory } from "../src/lib/auth/demo-directory";
import { DEMO_PASSWORD } from "../src/lib/auth/demo-presets";
import { loginSchema, portalHome, workspaceHref } from "../src/lib/portals";
import { demoData } from "../src/lib/demo-data";

let directory: DemoDirectory;
beforeEach(() => {
  directory = new DemoDirectory();
});
const input = {
  name: "Mingalar Shoes",
  username: "mingalar.shoes",
  role: "sme",
  password: "Temporary-STT-2026",
  phone: "09123456789",
  address: "Hlaing, Yangon",
  branchId: "",
  pin: { latitude: 16.84, longitude: 96.17 },
};
describe("HQ-issued portal credentials", () => {
  it("keeps the catalog to one STT model with explicit size/color variants", () => {
    expect(new Set(demoData.products.map((p) => p.name)).size).toBe(1);
    expect(
      demoData.products.every(
        (p) => p.brand === "STT" && p.category === "Shoes",
      ),
    ).toBe(true);
    expect(
      new Set(demoData.products.map((p) => `${p.color}-${p.size}`)).size,
    ).toBe(6);
  });
  it("requires the correct portal and password", () => {
    expect(
      directory.authenticate("driver", "myathida", DEMO_PASSWORD).status,
    ).toBe(401);
    expect(directory.authenticate("sme", "zawmin", DEMO_PASSWORD).status).toBe(
      401,
    );
    expect(directory.authenticate("sme", "myathida", "wrong").status).toBe(401);
    expect(
      directory.authenticate("sme", "myathida", DEMO_PASSWORD).user?.role,
    ).toBe("sme");
  });
  it("only lets signed-in HQ create accounts and rejects elevated roles", () => {
    expect(directory.provision(undefined, input).error).toBeTruthy();
    const sme = directory.authenticate("sme", "myathida", DEMO_PASSWORD);
    expect(directory.provision(sme.token, input).error).toBeTruthy();
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    expect(
      directory.provision(hq.token, { ...input, role: "hq" }).error,
    ).toBeTruthy();
    const first = directory.provision(hq.token, input);
    const second = directory.provision(hq.token, input);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.username).toBe(first.id);
    expect(second.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(first.temporaryPassword).not.toBe(input.password);
    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
    expect(first.temporaryPassword).toMatch(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!]).{28}$/,
    );
    expect(JSON.stringify(directory.workflowUsers())).not.toContain(
      first.temporaryPassword,
    );
    expect(
      directory.authenticate("sme", first.username!, input.password).status,
    ).toBe(401);
  });
  it("issues working credentials and requires a different first-login password", () => {
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    const issued = directory.provision(hq.token, input);
    const accountId = issued.username!;
    const user = directory.authenticate(
      "sme",
      accountId,
      issued.temporaryPassword!,
    );
    expect(user.user).toMatchObject({
      id: accountId,
      phone: "+959123456789",
      pin: input.pin,
    });
    expect(user.user?.mustChangePassword).toBe(true);
    expect(
      directory.changePassword(user.token, issued.temporaryPassword!).error,
    ).toBeTruthy();
    expect(directory.changePassword(user.token, "My-new-STT-password")).toEqual(
      {},
    );
    expect(directory.session(user.token)?.mustChangePassword).toBe(false);
    expect(
      directory.authenticate("sme", accountId, issued.temporaryPassword!)
        .status,
    ).toBe(401);
    expect(
      directory.authenticate("sme", accountId, "My-new-STT-password").status,
    ).toBe(200);
    expect(JSON.stringify(directory.listAccounts())).not.toContain(
      issued.temporaryPassword!,
    );
    expect(JSON.stringify(user.user)).not.toContain("hash");
  });
  it("issues driver accounts and invalidates signed-out sessions", () => {
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    const issued = directory.provision(hq.token, { ...input, role: "driver" });
    const accountId = issued.username!;
    expect(
      directory.authenticate("sme", accountId, issued.temporaryPassword!)
        .status,
    ).toBe(401);
    const user = directory.authenticate(
      "driver",
      accountId,
      issued.temporaryPassword!,
    );
    expect(user.user?.role).toBe("driver");
    directory.signOut(user.token);
    expect(directory.session(user.token)).toBeNull();
  });
  it("throttles repeated failed demo logins", () => {
    for (let i = 0; i < 8; i++)
      directory.authenticate("sme", "myathida", "wrong");
    expect(
      directory.authenticate("sme", "myathida", DEMO_PASSWORD).status,
    ).toBe(429);
  });
  it("uses stable portal endpoints rather than role query parameters", () => {
    expect(workspaceHref("sme", "orders", true)).toBe("/sme/orders");
    expect(workspaceHref("driver", "overview")).toBe("/driver");
    expect(workspaceHref("branch", "deliveries")).toBe("/branch/deliveries");
    expect(portalHome("branch")).toBe("/branch");
    expect(portalHome("hq")).toBe("/");
    expect(
      loginSchema.safeParse({ username: "bad@account", password: "x" }).success,
    ).toBe(false);
  });
  it("issues a branch-scoped credential only when a branch is selected", () => {
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    expect(
      directory.provision(hq.token, { ...input, role: "branch" }).error,
    ).toMatch(/branch/);
    const branchId = "10000000-0000-4000-8000-000000000001";
    const issued = directory.provision(hq.token, {
      ...input,
      role: "branch",
      branchId,
    });
    expect(issued.id).toBeTruthy();
    const login = directory.authenticate(
      "branch",
      issued.username!,
      issued.temporaryPassword!,
    );
    expect(login.user).toMatchObject({
      role: "branch",
      branchId,
      mustChangePassword: true,
    });
    expect(
      directory.authenticate("sme", issued.username!, issued.temporaryPassword!)
        .status,
    ).toBe(401);
  });
});
