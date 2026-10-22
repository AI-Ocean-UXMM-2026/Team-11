import { expect, it } from "vitest";
import {
  writePaymentInstructions,
  readPaymentInstructions,
  paymentDestinations,
} from "../src/lib/payment-instructions";
const accounts = [
  { method: "KPay", holder: "Test receiving account", number: "09123456789" },
  { method: "WavePay", holder: "Test business", number: "09987654321" },
];
it("round trips receiving methods, names and numbers without losing leading zeroes", () => {
  const saved = writePaymentInstructions(
    accounts,
    "Include your order reference.",
  );
  expect(readPaymentInstructions(saved)).toEqual({
    accounts,
    notes: "Include your order reference.",
  });
});
it("preserves saved receiving accounts when HQ changes its settings", () => {
  const saved = writePaymentInstructions(accounts, "Original notes"),
    current = writePaymentInstructions(
      [{ ...accounts[0], number: "09888888888" }],
      "New notes",
    );
  expect(paymentDestinations(saved, current)).toEqual({
    accounts,
    notes: "Original notes",
    addedLater: false,
  });
});
it("uses current accounts only for older orders that have none saved", () => {
  expect(
    paymentDestinations(
      "Legacy payment note",
      writePaymentInstructions(accounts, "New notes"),
    ),
  ).toEqual({ accounts, notes: "Legacy payment note", addedLater: true });
  expect(readPaymentInstructions("KPay or WavePay")).toEqual({
    accounts: [],
    notes: "KPay or WavePay",
  });
});
it("rejects missing account details, multiline fields, too many accounts and oversized instructions", () => {
  for (const bad of [
    [{ ...accounts[0], holder: " " }],
    [{ ...accounts[0], number: "" }],
    [{ ...accounts[0], method: "KPay\nWavePay" }],
    Array(6).fill(accounts[0]),
  ])
    expect(() => writePaymentInstructions(bad, "")).toThrow();
  expect(() => writePaymentInstructions(accounts, "x".repeat(1201))).toThrow();
});
