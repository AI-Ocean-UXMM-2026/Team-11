import { describe, expect, it } from "vitest";
import {
  internationalPhone,
  locationSchema,
  pinFromForm,
  phoneInputValue,
} from "../src/lib/contact";
import { accountSchema } from "../src/lib/domain";

describe("international contact details", () => {
  it("normalizes national and pasted international numbers without duplicating country codes", () => {
    expect(internationalPhone("9 123 456 789", "MM")).toBe("+959123456789");
    expect(internationalPhone("09 123 456 789", "MM")).toBe("+959123456789");
    expect(internationalPhone("202 555 0123", "US")).toBe("+12025550123");
    expect(internationalPhone("+12025550123", "MM")).toBe("+12025550123");
    expect(internationalPhone("123", "MM")).toBeNull();
    expect(internationalPhone("call me on +12025550123", "US")).toBeNull();
    expect(internationalPhone("2025550123", "XX")).toBeNull();
  });
  it("requires a complete valid pin and phone before issuing an account", () => {
    const input = {
      name: "Example Store",
      role: "sme",
      phone: "2025550123",
      phoneCountry: "US",
      address: "12 Hlaing Road, Yangon",
      pin: { latitude: 0, longitude: 0 },
    };
    expect(accountSchema.parse(input).phone).toBe("+12025550123");
    expect(accountSchema.safeParse({ ...input, pin: undefined }).success).toBe(
      false,
    );
    expect(accountSchema.safeParse({ ...input, phone: "123" }).success).toBe(
      false,
    );
    for (const pin of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: 0 },
      { latitude: NaN, longitude: 0 },
      { latitude: Infinity, longitude: 0 },
    ]) {
      expect(locationSchema.safeParse(pin).success).toBe(false);
    }
  });
  it("does not turn absent coordinates into an accidental zero pin", () => {
    const form = new FormData();
    expect(pinFromForm(form)).toBeUndefined();
    form.set("latitude", "");
    form.set("longitude", "");
    expect(pinFromForm(form)).toBeUndefined();
    form.set("latitude", "0");
    form.set("longitude", "0");
    expect(pinFromForm(form)).toEqual({ latitude: 0, longitude: 0 });
  });
});

it("keeps Myanmar phone entry without a trunk zero and recognizes pasted international numbers", () => {
  expect(phoneInputValue("09123456789", "MM")).toEqual({
    country: "MM",
    national: "9123456789",
  });
  expect(phoneInputValue("0", "MM").national).toBe("");
  expect(phoneInputValue("+959123456789", "MM")).toEqual({
    country: "MM",
    national: "9123456789",
  });
  expect(phoneInputValue("+12025550123", "MM")).toEqual({
    country: "US",
    national: "2025550123",
  });
});
