"use client";
import { useState } from "react";
import { ShieldCheck, Package } from "lucide-react";
import { money, type Product } from "@/lib/domain";
import { ShoeArt } from "./shoe-art";

export function ShoeCatalog({
  products,
  basket,
  change,
  demo,
}: {
  products: Product[];
  basket: Record<string, number>;
  change: (next: Record<string, number>) => void;
  demo: boolean;
}) {
  const [size, setSize] = useState("38");
  const [color, setColor] = useState("White");
  const product =
    products.find((p) => p.size === size && p.color === color) ?? products[0];
  if (!product) return null;
  const quantity = basket[product.id] ?? 0;
  const sizes = [
    ...new Set(
      products.filter((p) => p.color === product.color).map((p) => p.size),
    ),
  ];
  const colors = [...new Set(products.map((p) => p.color))];
  return (
    <section className="shoe-catalog">
      <div
        className={`shoe-display shoe-display-${product.color.toLowerCase()}`}
      >
        <span className="stt-wordmark">STT</span>
        <ShoeArt color={product.color} />
        <div className="shoe-display-caption">
          <strong>Everyday, in every step.</strong>
          <span>One model. Made for your shop.</span>
        </div>
      </div>
      <div className="shoe-selection">
        <span className="product-category">STT exclusive · Shoes</span>
        <h2>{product.name}</h2>
        <p>
          One dependable everyday sneaker, stocked by size and color. Select the
          variants your customers need.
        </p>
        <div className="shoe-price">
          {money(product.price)}
          <small> MMK / pair · Wholesale</small>
        </div>
        <fieldset className="variant-field">
          <legend>
            Color: <strong>{product.color}</strong>
          </legend>
          <div className="color-options">
            {colors.map((c) => (
              <button
                type="button"
                key={c}
                className={c === product.color ? "selected" : ""}
                aria-pressed={c === product.color}
                onClick={() => {
                  setColor(c);
                  setSize(product.size);
                }}
              >
                <span className={`swatch swatch-${c.toLowerCase()}`} />
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="variant-field">
          <legend>EU size</legend>
          <div className="size-options">
            {sizes.map((s) => (
              <button
                type="button"
                key={s}
                className={s === product.size ? "selected" : ""}
                aria-pressed={s === product.size}
                onClick={() => {
                  setSize(s);
                  setColor(product.color);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="shoe-availability">
          <Package size={17} />
          {product.stock} pairs available at HQ
          <span>Min. {product.minimum} pairs per variant</span>
        </div>
        <div className="shoe-add-row">
          <div className="quantity-control">
            <button
              type="button"
              aria-label="Remove selected shoe variant"
              disabled={!quantity}
              onClick={() =>
                change({
                  ...basket,
                  [product.id]: Math.max(0, quantity - product.minimum),
                })
              }
            >
              −
            </button>
            <span aria-live="polite">{quantity}</span>
            <button
              type="button"
              aria-label="Add selected shoe variant"
              disabled={!demo || quantity + product.minimum > product.stock}
              onClick={() =>
                change({ ...basket, [product.id]: quantity + product.minimum })
              }
            >
              +
            </button>
          </div>
          <span>
            {quantity
              ? `${quantity} ${product.color.toLowerCase()} pairs · EU ${product.size}`
              : "Add pairs to your order"}
          </span>
        </div>
        <div className="shoe-assurance">
          <ShieldCheck size={18} />
          <span>
            Supplied by STT Yangon HQ. Full payment is verified before
            confirmation.
          </span>
        </div>
        {products.some((p) => basket[p.id]) && (
          <div className="variant-basket">
            <strong>Selected variants</strong>
            {products
              .filter((p) => basket[p.id])
              .map((p) => (
                <div key={p.id}>
                  <span>
                    {p.color} · EU {p.size} · {basket[p.id]} pairs
                  </span>
                  <strong>{money(p.price * basket[p.id])} MMK</strong>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
