import { z } from "zod";
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);
export const receivingAccountSchema = z.object({
  method: line(40),
  holder: line(100),
  number: line(80),
});
export type ReceivingAccount = z.infer<typeof receivingAccountSchema>;
const setupSchema = z.object({
  format: z.literal("supplylink-payment-v1"),
  accounts: z.array(receivingAccountSchema).min(1).max(5),
  notes: z.string().trim().max(1200),
});
export type PaymentInstructions = {
  accounts: ReceivingAccount[];
  notes: string;
};
export function readPaymentInstructions(
  value: string = "",
): PaymentInstructions {
  try {
    const parsed = setupSchema.safeParse(JSON.parse(value));
    if (parsed.success)
      return { accounts: parsed.data.accounts, notes: parsed.data.notes };
  } catch {}
  return { accounts: [], notes: value };
}
export function writePaymentInstructions(
  accounts: ReceivingAccount[],
  notes: string,
): string {
  const parsed = setupSchema.safeParse({
    format: "supplylink-payment-v1",
    accounts,
    notes,
  });
  if (!parsed.success)
    throw new Error(
      "Enter a payment method, account holder and account number for each receiving account. Use up to five accounts and 1,200 characters of instructions.",
    );
  const text = JSON.stringify(parsed.data);
  if (text.length > 2000)
    throw new Error(
      "Shorten the receiving-account details or payment notes to fit within 2,000 characters.",
    );
  return text;
}
export function paymentDestinations(saved: string, current: string = "") {
  const original = readPaymentInstructions(saved),
    latest = readPaymentInstructions(current);
  const useCurrent = !original.accounts.length && latest.accounts.length > 0;
  return {
    ...original,
    accounts: useCurrent ? latest.accounts : original.accounts,
    addedLater: useCurrent,
  };
}
export const demoPaymentInstructions = writePaymentInstructions(
  [
    {
      method: "KPay",
      holder: "Supply Link demo — do not transfer",
      number: "DEMO-KPAY-001",
    },
    {
      method: "WavePay",
      holder: "Supply Link demo — do not transfer",
      number: "DEMO-WAVE-002",
    },
  ],
  "DEMO ONLY — these are non-payment sample identifiers. Do not transfer money. Use the sample receipt to demonstrate HQ verification.",
);
