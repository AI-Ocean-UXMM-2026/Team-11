"use client";
import { useRef, useState, useTransition } from "react";
import { workflowAction } from "@/app/workflow-actions";
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
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  function submit(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form));
    const action = mode === "settings" ? "configure" : String(values.action);
    const payload =
      mode === "settings"
        ? {
            shipping: Number(values.shipping),
            instructions: String(values.instructions),
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
            <label className="field">
              Receiving account & payment instructions
              <textarea
                name="instructions"
                minLength={5}
                maxLength={2000}
                required
                defaultValue={data.settings?.instructions}
              />
            </label>
            <p className="muted">
              New quotes use these settings. Existing orders keep their original
              prices, shipping and instructions.
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
