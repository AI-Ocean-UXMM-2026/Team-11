"use client";
import { useState } from "react";
import { Check, Copy, Wallet } from "lucide-react";
import { money } from "@/lib/domain";
import { paymentDestinations } from "@/lib/payment-instructions";
export function PaymentDestinations({
  instructions,
  currentInstructions = "",
  amount,
  demo = false,
  paymentConfirmed = false,
}: {
  instructions: string;
  currentInstructions?: string;
  amount: number;
  demo?: boolean;
  paymentConfirmed?: boolean;
}) {
  const details = paymentDestinations(instructions, currentInstructions);
  const [copied, setCopied] = useState<number | null>(null),
    [copyError, setCopyError] = useState("");
  async function copy(number: string, index: number) {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(index);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy is unavailable. Select and copy the account number below.",
      );
    }
  }
  return (
    <section className="payment-destinations" aria-label="Where to transfer">
      <div className="payment-destinations-heading">
        <span className="payment-wallet-icon">
          <Wallet size={22} />
        </span>
        <div>
          <h3>
            {paymentConfirmed ? "Receiving accounts" : "Where to transfer"}
          </h3>
          <p>
            {paymentConfirmed
              ? "Receiving details for this order."
              : "Choose one receiving account below."}
          </p>
        </div>
      </div>
      {demo && (
        <p className="payment-demo-note">
          Demo only — do not transfer real money.
        </p>
      )}
      {details.accounts.length ? (
        <div className="receiving-account-list">
          {details.accounts.map((account, index) => (
            <div
              className="receiving-account"
              key={`${account.method}:${account.number}:${index}`}
            >
              <strong className="receiving-method">{account.method}</strong>
              <dl>
                <div>
                  <dt>Account holder</dt>
                  <dd>{account.holder}</dd>
                </div>
                <div>
                  <dt>Account number / phone</dt>
                  <dd className="receiving-number">{account.number}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="button secondary"
                aria-label={`Copy ${account.method} account number`}
                onClick={() => void copy(account.number, index)}
              >
                {copied === index ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied === index ? "Copied" : "Copy number"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="payment-account-missing" role="status">
          {paymentConfirmed
            ? "No receiving account number was saved with this order."
            : "HQ has not provided a receiving account number. Contact HQ before transferring."}
        </p>
      )}
      {details.addedLater && (
        <p className="payment-account-updated">
          HQ added these receiving accounts after this order was saved.
        </p>
      )}
      <div className="payment-transfer-total">
        <span>
          {paymentConfirmed ? "Order total" : "Transfer the full quoted total"}
        </span>
        <strong>{money(amount)} MMK</strong>
      </div>
      {details.notes && (
        <div className="payment-notes">
          <strong>Payment instructions</strong>
          <p>{details.notes}</p>
        </div>
      )}
      <span role="status" className="sr-only">
        {copied !== null ? "Account number copied." : ""}
      </span>
      {copyError && (
        <p role="status" className="payment-copy-error">
          {copyError}
        </p>
      )}
    </section>
  );
}
