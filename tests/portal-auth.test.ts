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
    expect(directory.provision(hq.token, input).id).toBeTruthy();
    expect(directory.provision(hq.token, input).error).toMatch(
      /already in use/,
    );
  });
  it("issues working credentials and requires a different first-login password", () => {
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    directory.provision(hq.token, input);
    const user = directory.authenticate("sme", input.username, input.password);
    expect(user.user?.mustChangePassword).toBe(true);
    expect(
      directory.changePassword(user.token, input.password).error,
    ).toBeTruthy();
    expect(directory.changePassword(user.token, "My-new-STT-password")).toEqual(
      {},
    );
    expect(directory.session(user.token)?.mustChangePassword).toBe(false);
    expect(
      directory.authenticate("sme", input.username, input.password).status,
    ).toBe(401);
    expect(
      directory.authenticate("sme", input.username, "My-new-STT-password")
        .status,
    ).toBe(200);
    expect(JSON.stringify(directory.listAccounts())).not.toContain(
      input.password,
    );
    expect(JSON.stringify(user.user)).not.toContain("hash");
  });
  it("issues driver accounts and invalidates signed-out sessions", () => {
    const hq = directory.authenticate("hq", "hq.admin", DEMO_PASSWORD);
    directory.provision(hq.token, {
      ...input,
      username: "driver.new",
      role: "driver",
    });
    expect(
      directory.authenticate("sme", "driver.new", input.password).status,
    ).toBe(401);
    const user = directory.authenticate("driver", "driver.new", input.password);
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
    expect(portalHome("hq")).toBe("/");
    expect(
      loginSchema.safeParse({ username: "bad@account", password: "x" }).success,
    ).toBe(false);
  });
});
