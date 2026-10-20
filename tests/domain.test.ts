import { describe, expect, it } from "vitest";
import {
  accountSchema,
  businessDate,
  canAccess,
  csvCell,
  loginEmail,
  merchandiseSales,
  ordersCsv,
  total,
} from "../src/lib/domain";
import { demoData, demoForRole } from "../src/lib/demo-data";
describe("business boundaries", () => {
  it("uses Yangon date boundaries for stored event timestamps", () => {
    expect(businessDate("2026-10-20T18:00:00Z")).toBe("2026-10-21");
    expect(businessDate("2026-10-20T17:00:00Z")).toBe("2026-10-20");
  });
  it("recognises only Done wholesale merchandise, excluding shipping and other states", () => {
    expect(merchandiseSales(demoData.orders)).toBe(1035000);
    expect(total(demoData.orders[0])).toBe(365000);
    expect(
      merchandiseSales(demoData.orders.filter((o) => o.status === "Complete")),
    ).toBe(0);
  });
  it("limits role navigation", () => {
    expect(canAccess("sme", "accounts")).toBe(false);
    expect(canAccess("driver", "reports")).toBe(false);
    expect(canAccess("branch", "orders")).toBe(false);
    expect(canAccess("hq", "accounts")).toBe(true);
  });
  it("scopes demo records by role", () => {
    expect(demoForRole("sme").orders.every((o) => o.initials === "MT")).toBe(
      true,
    );
    expect(demoForRole("driver").accounts).toHaveLength(0);
    expect(
      demoForRole("branch").retailSales.every((s) => s.branchId === "b1"),
    ).toBe(true);
  });
});
describe("account inputs", () => {
  const valid = {
    name: "Example Mart",
    username: "example.mart",
    role: "sme",
    password: "Temporary-pass-123",
    phone: "0912345678",
    address: "Hlaing, Yangon",
    branchId: "",
  };
  it("rejects privilege escalation and malformed account IDs", () => {
    expect(accountSchema.safeParse(valid).success).toBe(true);
    expect(accountSchema.safeParse({ ...valid, role: "hq" }).success).toBe(
      false,
    );
    expect(
      accountSchema.safeParse({ ...valid, username: "user@example.com" })
        .success,
    ).toBe(false);
    expect(
      accountSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
    expect(
      accountSchema.safeParse({ ...valid, branchId: "invalid" }).success,
    ).toBe(false);
    expect(loginEmail(" Example.Mart ")).toBe(
      "example.mart@login.supplylink.invalid",
    );
  });
});
describe("CSV exports", () => {
  it("escapes quotes, commas, newlines and spreadsheet formulas", () => {
    expect(csvCell('Hello, "shop"')).toBe('"Hello, ""shop"""');
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("exports exactly the selection with full total and shipping separated", () => {
    const csv = ordersCsv(demoData.orders.slice(0, 1));
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"360000","5000","365000"');
    expect(csv).not.toContain("SL-2026-1047");
  });
});
