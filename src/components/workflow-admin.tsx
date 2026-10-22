"use client";
import { useRef, useState, useTransition } from "react";
import { workflowAction } from "@/app/workflow-actions";
import { Plus, X } from "lucide-react";
import {
  readPaymentInstructions,
  writePaymentInstructions,
  type ReceivingAccount,
} from "@/lib/payment-instructions";
import type { WorkspaceData } from "@/lib/domain";
export function WorkflowAdmin({
  data,
  mode,
  updated,
}: {
  data: WorkspaceData;
  mode: "settings" | "inventory";
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
}) {
  const [receivingAccounts, setReceivingAccounts] = useState<
    ReceivingAccount[]
  >(() => {
    const saved = readPaymentInstructions(data.settings?.instructions).accounts;
    return saved.length ? saved : [{ method: "KPay", holder: "", number: "" }];
  });
  function changeAccount(
    index: number,
    key: keyof ReceivingAccount,
    value: string,
  ) {
    setReceivingAccounts((accounts) =>
      accounts.map((account, i) =>
        i === index ? { ...account, [key]: value } : account,
      ),
    );
  }
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  function submit(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form));
    const action = mode === "settings" ? "configure" : String(values.action);
    let instructions = "";
    if (mode === "settings") {
      try {
        instructions = writePaymentInstructions(
          receivingAccounts,
          String(values.instructions ?? ""),
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Check the receiving accounts.",
        );
        return;
      }
    }
    const payload =
      mode === "settings"
        ? {
            shipping: Number(values.shipping),
            instructions,
          }
        : {
            productId: String(values.productId),
            branchId: String(values.branchId),
            onHand: Number(values.onHand),
            price: Number(values.price),
            reason: String(values.reason),
          };
    const fingerprint = JSON.stringify([action, payload]);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const key = retry.current.key;
    setError("");
    start(async () => {
      try {
        const r = await workflowAction(action, payload, key, data.query);
        if (r.error) setError(r.error);
        else if (r.data) {
          retry.current = null;
          await updated(r.data, r.result?.message);
        }
      } catch {
        setError("Connection interrupted. Retry with the same details.");
      }
    });
  }
  return (
    <section className="panel workflow-admin">
      <div className="panel-heading">
        <h2>
          {mode === "settings"
            ? "Delivery & payment setup"
            : "Adjust STT stock or price"}
        </h2>
      </div>
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        {mode === "settings" ? (
          <>
            <label className="field">
              Yangon shipping fee (MMK)
              <input
                type="number"
                name="shipping"
                min={0}
                max={1000000000}
                step={1}
                required
                defaultValue={data.settings?.shipping ?? ""}
              />
            </label>
            <div className="payment-account-editor">
              <div className="payment-editor-heading">
                <div>
                  <h3>Receiving accounts</h3>
                  <p className="muted">
                    SMEs see these details before uploading a receipt. Enter the
                    actual account holder and number.
                  </p>
                </div>
              </div>
              {receivingAccounts.map((account, index) => (
                <fieldset className="payment-account-fields" key={index}>
                  <legend>Receiving account {index + 1}</legend>
                  <div className="payment-account-field-grid">
                    <label className="field">
                      Payment method
                      <input
                        list="payment-method-options"
                        name={`paymentMethod${index}`}
                        value={account.method}
                        onChange={(e) =>
                          changeAccount(index, "method", e.target.value)
                        }
                        maxLength={40}
                        required
                        placeholder="KPay, WavePay or bank name"
                      />
                    </label>
                    <label className="field">
                      Account holder
                      <input
                        name={`accountHolder${index}`}
                        value={account.holder}
                        onChange={(e) =>
                          changeAccount(index, "holder", e.target.value)
                        }
                        maxLength={100}
                        required
                        placeholder="Receiving account name"
                      />
                    </label>
                    <label className="field">
                      Account number / phone
                      <input
                        name={`accountNumber${index}`}
                        value={account.number}
                        onChange={(e) =>
                          changeAccount(index, "number", e.target.value)
                        }
                        maxLength={80}
                        required
                        placeholder="Receiving wallet or bank number"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  {receivingAccounts.length > 1 && (
                    <button
                      type="button"
                      className="text-link"
                      aria-label={`Remove receiving account ${index + 1}`}
                      onClick={() =>
                        setReceivingAccounts((accounts) =>
                          accounts.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X size={15} />
                      Remove account
                    </button>
                  )}
                </fieldset>
              ))}
              <datalist id="payment-method-options">
                <option value="KPay" />
                <option value="WavePay" />
                <option value="AYA Pay" />
                <option value="Bank transfer" />
              </datalist>
              <button
                type="button"
                className="button secondary"
                disabled={receivingAccounts.length >= 5}
                onClick={() =>
                  setReceivingAccounts((accounts) => [
                    ...accounts,
                    { method: "WavePay", holder: "", number: "" },
                  ])
                }
              >
                <Plus size={16} />
                Add receiving account
              </button>
            </div>
            <label className="field">
              Additional payment instructions (optional)
              <textarea
                name="instructions"
                maxLength={1200}
                defaultValue={
                  readPaymentInstructions(data.settings?.instructions).notes
                }
              />
            </label>
            <p className="muted">
              New quotes use these settings. Existing orders keep their original
              prices, shipping and receiving details. Older orders without saved
              receiving accounts can display accounts added here later.
            </p>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                Variant
                <select name="productId">
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.pack}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Adjustment
                <select name="action">
                  <option value="stock">Set physical on-hand stock</option>
                  <option value="price">Set wholesale price</option>
                </select>
              </label>
            </div>
            <label className="field">
              Stock location
              <select name="branchId">
                <option value="">STT Yangon HQ</option>
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                New on-hand pairs
                <input
                  type="number"
                  name="onHand"
                  min={0}
                  max={1000000}
                  step={1}
                  defaultValue={0}
                />
              </label>
              <label className="field">
                New wholesale price (MMK)
                <input
                  type="number"
                  name="price"
                  min={1}
                  max={1000000000}
                  step={1}
                  defaultValue={45000}
                />
              </label>
            </div>
            <label className="field">
              Reason
              <textarea name="reason" minLength={3} maxLength={1000} required />
            </label>
            <p className="muted">
              Stock counts cannot consume protected or allocated pairs. Price
              adjustments apply to new quotes.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </section>
  );
}
