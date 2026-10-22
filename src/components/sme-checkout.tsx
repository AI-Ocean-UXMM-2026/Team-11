"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  LockKeyhole,
  MapPin,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import { workflowAction } from "@/app/workflow-actions";
import {
  cartError,
  cartLines,
  productPhoto,
  productUnit,
  type Cart,
} from "@/lib/checkout";
import {
  internationalPhone,
  pinFromForm,
  type LocationPin,
} from "@/lib/contact";
import {
  money,
  total,
  type Order,
  type Viewer,
  type WorkspaceData,
} from "@/lib/domain";
import type { WorkspaceQuery } from "@/lib/workflow/query";
import { PaymentDestinations } from "./payment-destinations";
import { ProductCatalog } from "./product-catalog";
import { PhoneField } from "./phone-field";
import { LocationPicker } from "./location-picker";

type Step = "items" | "cart" | "shop" | "review" | "evidence" | "done";
type Shop = {
  name: string;
  receiver: string;
  phone: string;
  country: string;
  address: string;
  notes: string;
  pin?: LocationPin;
};
const titles: Record<Step, string> = {
  items: "Select products",
  cart: "Your cart",
  shop: "Add shop information",
  review: "Review your order",
  evidence: "Upload transaction evidence",
  done: "Order submitted",
};

export function SmeCheckout({
  data,
  viewer,
  search,
  query,
  updated,
  viewOrder,
  demo,
}: {
  data: WorkspaceData;
  viewer: Viewer;
  search: string;
  query: WorkspaceQuery;
  updated: (data: WorkspaceData, message?: string) => Promise<void>;
  viewOrder: (order: Order) => void;
  demo: boolean;
}) {
  const [step, setStep] = useState<Step>("items");
  const [basket, setBasket] = useState<Cart>({});
  const [shop, setShop] = useState<Shop>({
    name: viewer.name,
    receiver: viewer.name,
    phone: data.profile?.phone ?? "",
    country: "MM",
    address: data.profile?.address ?? "",
    notes: "",
    pin: data.profile?.pin ?? undefined,
  });
  const [created, setCreated] = useState<Order | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const uploadRetry = useRef<{ fingerprint: string; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lines = cartLines(data.products, basket);
  const count = lines.reduce((n, p) => n + p.quantity, 0);
  const subtotal = lines.reduce((n, p) => n + p.quantity * p.price, 0);
  const shipping = data.settings?.shipping;
  const issue = cartError(data.products, basket);
  const index = step === "items" ? 0 : step === "cart" ? 1 : 2;
  useEffect(() => {
    if (step !== "items") heading.current?.focus();
  }, [step]);
  function go(next: Step) {
    setError("");
    setStep(next);
  }
  function nextFromCart() {
    if (issue) {
      setError(issue);
      return;
    }
    if (shipping == null || !data.settings?.instructions) {
      setError(
        "HQ must configure shipping and payment instructions before you can order.",
      );
      return;
    }
    go("shop");
  }
  function saveShop(form: FormData) {
    const country = String(form.get("phoneCountry") ?? "MM");
    const phone = internationalPhone(String(form.get("phone") ?? ""), country);
    if (!phone) {
      setError(
        "Enter a valid phone number for the person receiving this delivery.",
      );
      return;
    }
    setShop({
      name: String(form.get("shopName")).trim(),
      receiver: String(form.get("receiver")).trim(),
      phone,
      country,
      address: String(form.get("address")).trim(),
      notes: String(form.get("notes") ?? "").trim(),
      pin: pinFromForm(form),
    });
    go("review");
  }
  async function confirmOrder() {
    if (pending || created) return;
    if (issue || shipping == null) {
      setError(issue ?? "Wait for HQ to configure shipping.");
      return;
    }
    const payload = {
      items: lines.map((p) => ({ productId: p.id, quantity: p.quantity })),
      receiver: shop.receiver,
      phone: shop.phone,
      address: shop.address,
      pin: shop.pin,
      notes: `Shop: ${shop.name}${shop.notes ? `\n${shop.notes}` : ""}`,
      area: data.settings?.area ?? "Yangon",
      expectedTotal: subtotal + shipping,
    };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      const result = await workflowAction(
        "create",
        payload,
        retry.current.key,
        query,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      const order =
        result.data?.selectedOrder ??
        result.data?.orders.find((o) => o.id === result.result?.orderId);
      if (!order) {
        setError(
          "The order response was interrupted. Retry to recover the same order.",
        );
        return;
      }
      setCreated(order);
      retry.current = null;
      go("evidence");
      try {
        if (result.data) await updated(result.data);
      } catch {
        setError(
          "Your order was saved. The workspace refresh was interrupted; you can still upload evidence below.",
        );
      }
    } catch {
      setError(
        "The connection was interrupted. Retry without changing your details to recover the same order.",
      );
    } finally {
      setPending(false);
    }
  }
  async function uploadEvidence(form: HTMLFormElement) {
    if (!created || pending) return;
    const values = new FormData(form),
      file = values.get("file") as File;
    if (
      !file?.size ||
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG or JPEG receipt up to 5 MB.");
      return;
    }
    const fingerprint = JSON.stringify([
      created.id,
      file.name,
      file.size,
      file.lastModified,
      values.get("reference"),
      values.get("amount"),
    ]);
    if (uploadRetry.current?.fingerprint !== fingerprint)
      uploadRetry.current = { fingerprint, key: crypto.randomUUID() };
    values.set("operationKey", uploadRetry.current.key);
    values.set("query", JSON.stringify({ ...query, orderId: created.id }));
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${created.id}/evidence`, {
        method: "POST",
        body: values,
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        setError(result.error ?? "Evidence could not be uploaded. Try again.");
        return;
      }
      const fresh: Order =
        result.data?.selectedOrder ??
        result.data?.orders?.find((o: Order) => o.id === created.id);
      if (!fresh || !fresh.workflow?.evidence.length) {
        setError(
          "Evidence confirmation was interrupted. Retry the same submission.",
        );
        return;
      }
      setCreated(fresh);
      uploadRetry.current = null;
      go("done");
      try {
        await updated(result.data);
      } catch {
        setError(
          "Evidence was submitted. Refresh your orders to see the latest status.",
        );
      }
    } catch {
      setError(
        "Upload interrupted. Keep this receipt and reference selected, then retry.",
      );
    } finally {
      setPending(false);
    }
  }
  function summary() {
    return (
      <aside className="checkout-summary">
        <h3>Order summary</h3>
        <dl>
          <div>
            <dt>
              {created?.items ?? count}{" "}
              {productUnit(
                lines[0] ?? data.products[0] ?? { category: "Longyi" },
              )}
              s
            </dt>
            <dd>{money(created?.merchandise ?? subtotal)} MMK</dd>
          </div>
          <div>
            <dt>Delivery to {data.settings?.area ?? "Yangon"}</dt>
            <dd>
              {shipping == null
                ? "Awaiting HQ setup"
                : `${money(created?.shipping ?? shipping)} MMK`}
            </dd>
          </div>
          <div className="checkout-total">
            <dt>Total</dt>
            <dd>
              {money(created ? total(created) : subtotal + (shipping ?? 0))} MMK
            </dd>
          </div>
        </dl>
        <p>
          <LockKeyhole size={16} />
          Payment evidence is private. HQ verifies your transfer before
          reserving stock.
        </p>
      </aside>
    );
  }
  function cartList(editable: boolean) {
    return (
      <div className="checkout-cart-list">
        {lines.map((p) => (
          <article className="checkout-cart-item" key={p.id}>
            <Image
              src={productPhoto(p)}
              alt={`${p.name}, ${p.pack}`}
              width={160}
              height={120}
              sizes="135px"
            />
            <div className="checkout-cart-description">
              <h3>{p.name}</h3>
              <p>{p.pack}</p>
              <small>
                {p.category} · {money(p.price)} MMK / {productUnit(p)}
              </small>
              {editable ? (
                <div className="cart-item-actions">
                  <label>
                    Pairs
                    <input
                      aria-label={`${p.name} ${p.pack} cart quantity`}
                      type="number"
                      min={p.minimum}
                      max={p.stock}
                      step={p.minimum}
                      value={p.quantity}
                      onChange={(e) =>
                        setBasket({
                          ...basket,
                          [p.id]: Math.max(1, Number(e.target.value)),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Remove ${p.name} ${p.pack}`}
                    onClick={() => {
                      const next = { ...basket };
                      delete next[p.id];
                      setBasket(next);
                    }}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                </div>
              ) : (
                <p>
                  {p.quantity} {productUnit(p)}
                  {p.quantity === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <strong>{money(p.price * p.quantity)} MMK</strong>
          </article>
        ))}
      </div>
    );
  }
  return (
    <section
      className={`sme-checkout checkout-stage-${step}`}
      aria-busy={pending}
    >
      <ol className="checkout-steps" aria-label="Order progress">
        {["Select items", "View cart", "Order"].map((label, i) => (
          <li
            key={label}
            className={i === index ? "current" : i < index ? "complete" : ""}
            aria-current={i === index ? "step" : undefined}
          >
            <span>{i < index ? <Check size={16} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step !== "items" && (
        <header className="checkout-heading">
          <div>
            <p>
              {step === "cart"
                ? "A good fit for your shop"
                : "Your wholesale order"}
            </p>
            <h2 ref={heading} tabIndex={-1}>
              {titles[step]}
            </h2>
          </div>
          {!created && (
            <button
              className="text-link"
              disabled={pending}
              onClick={() =>
                go(
                  step === "cart" ? "items" : step === "shop" ? "cart" : "shop",
                )
              }
            >
              <ArrowLeft size={16} />
              {step === "cart" ? "Continue shopping" : "Back"}
            </button>
          )}
        </header>
      )}
      {index === 2 && step !== "done" && (
        <div className="checkout-substeps" aria-label="Checkout details">
          <span className={step === "shop" ? "current" : ""}>
            Shop information
          </span>
          <span className={step === "review" ? "current" : ""}>
            Review order
          </span>
          <span className={step === "evidence" ? "current" : ""}>
            Transaction evidence
          </span>
        </div>
      )}
      {step === "items" && (
        <ProductCatalog
          products={data.products}
          basket={basket}
          change={setBasket}
          search={search}
          viewCart={() => go("cart")}
        />
      )}
      {step === "cart" &&
        (!lines.length ? (
          <div className="checkout-empty">
            <ShoppingBag size={36} />
            <h3>Your cart is empty</h3>
            <p>Browse the product catalog to start your next order.</p>
            <button className="button primary" onClick={() => go("items")}>
              Browse products
            </button>
          </div>
        ) : (
          <div className="checkout-columns">
            <div>
              {cartList(true)}
              <p className="checkout-stock-note">
                Adding items to your cart does not reserve stock. Prices and
                availability are checked when you confirm.
              </p>
            </div>
            <div>
              {summary()}
              <button
                className="button primary full-width"
                onClick={nextFromCart}
              >
                Confirm cart & order
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        ))}
      {step === "shop" && (
        <div className="checkout-columns">
          <form
            className="checkout-shop-form panel"
            onSubmit={(e) => {
              e.preventDefault();
              saveShop(new FormData(e.currentTarget));
            }}
          >
            <h3>Where should we deliver?</h3>
            <p className="muted">
              Your saved account location is prefilled. Change details for this
              order, or update your default delivery location in Settings.
            </p>
            <div className="form-grid">
              <label className="field">
                Shop name
                <input
                  name="shopName"
                  defaultValue={shop.name}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="organization"
                />
              </label>
              <label className="field">
                Receiver name
                <input
                  name="receiver"
                  defaultValue={shop.receiver}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
            </div>
            <PhoneField
              label="Receiver phone"
              initialValue={shop.phone}
              initialCountry={shop.country}
            />
            <label className="field">
              Full delivery address
              <textarea
                name="address"
                value={shop.address}
                onChange={(event) =>
                  setShop((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                required
                minLength={5}
                maxLength={300}
                autoComplete="street-address"
                placeholder="Street, building, township, Yangon"
              />
            </label>
            <LocationPicker
              label="Shop location pin"
              initialPin={shop.pin}
              addressValue={shop.address}
              onAddressChange={(address) =>
                setShop((current) => ({ ...current, address }))
              }
            />
            <label className="field">
              Delivery notes (optional)
              <textarea
                name="notes"
                defaultValue={shop.notes}
                maxLength={800}
                placeholder="Opening hours or directions for your driver"
              />
            </label>
            <button className="button primary" type="submit">
              Review order
              <ArrowRight size={17} />
            </button>
          </form>
          {summary()}
        </div>
      )}
      {step === "review" && (
        <div className="checkout-columns">
          <div>
            <div className="checkout-review-shop panel">
              <div>
                <MapPin size={23} />
                <div>
                  <h3>{shop.name}</h3>
                  <p>
                    {shop.receiver} · {shop.phone}
                  </p>
                  <p>{shop.address}</p>
                  {shop.notes && <small>{shop.notes}</small>}
                </div>
              </div>
              <button
                className="text-link"
                disabled={pending}
                onClick={() => go("shop")}
              >
                Edit details
              </button>
            </div>
            {cartList(false)}
            <p className="checkout-stock-note">
              Confirming saves your order and its quoted total. Next, upload
              your transfer receipt to submit it for HQ verification.
            </p>
          </div>
          <div>
            {summary()}
            <button
              className="button primary full-width"
              disabled={pending || !!issue}
              onClick={() => void confirmOrder()}
            >
              {pending ? "Saving your order…" : "Confirm order & continue"}
              <ArrowRight size={17} />
            </button>
            {issue && (
              <p className="form-error" role="alert">
                {issue}
                <button className="text-link" onClick={() => go("cart")}>
                  Edit cart
                </button>
              </p>
            )}
          </div>
        </div>
      )}
      {step === "evidence" && created && (
        <div className="checkout-columns">
          <form
            className="checkout-evidence-form panel"
            onSubmit={(e) => {
              e.preventDefault();
              void uploadEvidence(e.currentTarget);
            }}
          >
            <h3>Your order is saved</h3>
            <p className="checkout-reference">{created.reference}</p>
            <PaymentDestinations
              instructions={created.workflow?.instructions ?? ""}
              currentInstructions={data.settings?.instructions}
              amount={total(created)}
              demo={demo}
            />
            <label className="field">
              Transaction receipt
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg"
                required
                disabled={pending}
              />
            </label>
            <small className="muted">PNG or JPEG, up to 5 MB.</small>
            {demo && (
              <a
                className="text-link"
                href="/api/demo/receipt"
                download="demo-receipt.png"
              >
                Download a sample demo receipt
              </a>
            )}
            <div className="form-grid">
              <label className="field">
                Transfer reference
                <input
                  name="reference"
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="Transaction ID from your bank receipt"
                  disabled={pending}
                />
                <small>
                  The reference number shown on your payment receipt.
                </small>
              </label>
              <label className="field">
                Transferred amount (MMK)
                <input
                  type="number"
                  name="amount"
                  min={1}
                  step={1}
                  defaultValue={total(created)}
                  required
                  disabled={pending}
                />
              </label>
            </div>
            <p className="checkout-stock-note">
              HQ checks the actual received transfer. Uploading evidence does
              not approve payment or reserve stock.
            </p>
            <button className="button primary" disabled={pending}>
              <Upload size={17} />
              {pending ? "Uploading evidence…" : "Submit order"}
            </button>
            <button
              className="text-link"
              type="button"
              disabled={pending}
              onClick={() => viewOrder(created)}
            >
              Finish later in My orders
            </button>
          </form>
          {summary()}
        </div>
      )}
      {step === "done" && created && (
        <div className="checkout-success panel">
          <span className="checkout-success-icon">
            <CheckCircle2 size={44} />
          </span>
          <h2>Your order is with HQ</h2>
          <p>
            Transaction evidence received. HQ will verify your payment before
            confirming the order and reserving your products.
          </p>
          <div className="checkout-success-reference">
            <small>Order reference</small>
            <strong>{created.reference}</strong>
            <span>Awaiting verification</span>
          </div>
          <div className="checkout-success-actions">
            <button
              className="button primary"
              onClick={() => viewOrder(created)}
            >
              View order
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setBasket({});
                setCreated(null);
                go("items");
              }}
            >
              Continue shopping
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error checkout-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
