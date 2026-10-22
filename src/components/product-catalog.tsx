"use client";
import { useState } from "react";
import Image from "next/image";
import { Check, Plus, ShoppingBag } from "lucide-react";
import { money, type Product } from "@/lib/domain";
import { cartLines, productPhoto, type Cart } from "@/lib/checkout";

function ProductCard({
  variants,
  basket,
  change,
}: {
  variants: Product[];
  basket: Cart;
  change: (cart: Cart) => void;
}) {
  const [size, setSize] = useState(variants[0].size);
  const [quantity, setQuantity] = useState(variants[0].minimum);
  const [added, setAdded] = useState("");
  const product = variants.find((p) => p.size === size) ?? variants[0];
  const available = Math.max(0, product.stock - (basket[product.id] ?? 0));
  const valid =
    Number.isInteger(quantity) &&
    quantity >= product.minimum &&
    quantity % product.minimum === 0 &&
    quantity <= available;
  return (
    <article className="sneaker-card">
      <div
        className={`sneaker-photo sneaker-photo-${product.color.toLowerCase()}`}
      >
        <Image
          src={productPhoto(product.color)}
          alt={`${product.color} STT Everyday sneaker, side view`}
          width={1448}
          height={1086}
          sizes="(max-width: 600px) 100vw, (max-width: 1000px) 45vw, 40vw"
        />
        <span className="sneaker-color">{product.color}</span>
      </div>
      <div className="sneaker-card-body">
        <div className="sneaker-card-heading">
          <div>
            <p>STT Everyday collection</p>
            <h2>{product.color} sneaker</h2>
          </div>
          <p className="sneaker-unit-price">
            <strong>{money(product.price)}</strong> MMK <span>/ pair</span>
          </p>
        </div>
        <p className="sneaker-description">
          Low-top sneaker · Lace-up fit · Durable sole
        </p>
        <div className="sneaker-selection">
          <fieldset className="variant-field">
            <legend>Choose EU size</legend>
            <div className="size-options">
              {variants.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={product.id === p.id}
                  disabled={p.stock < p.minimum}
                  className={product.id === p.id ? "selected" : ""}
                  onClick={() => {
                    setSize(p.size);
                    setQuantity(p.minimum);
                    setAdded("");
                  }}
                >
                  {p.size}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="sneaker-add-controls">
            <label className="field">
              Pairs
              <input
                aria-label={`${product.color} sneaker quantity`}
                type="number"
                min={product.minimum}
                max={available}
                step={product.minimum}
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  setAdded("");
                }}
              />
            </label>
            <button
              className="button primary"
              disabled={!valid}
              onClick={() => {
                change({
                  ...basket,
                  [product.id]: (basket[product.id] ?? 0) + quantity,
                });
                setAdded(
                  `${quantity} ${product.color.toLowerCase()} pairs, EU ${product.size}, added to cart.`,
                );
              }}
            >
              <Plus size={17} />
              Add to cart
            </button>
          </div>
        </div>
        <p className="sneaker-stock">
          {available} pairs available · Minimum {product.minimum} per size
        </p>
        <p className="sneaker-added" role="status">
          {added && (
            <>
              <Check size={15} />
              {added}
            </>
          )}
        </p>
      </div>
    </article>
  );
}

export function ProductCatalog({
  products,
  basket,
  change,
  search = "",
  viewCart,
}: {
  products: Product[];
  basket: Cart;
  change: (cart: Cart) => void;
  search?: string;
  viewCart: () => void;
}) {
  const groups = [...new Set(products.map((p) => p.color))].map((color) =>
    products.filter((p) => p.color === color),
  );
  const visible = groups.filter((variants) =>
    variants.some((p) =>
      `${p.name} ${p.color} ${p.size}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  const lines = cartLines(products, basket),
    count = lines.reduce((n, p) => n + p.quantity, 0),
    subtotal = lines.reduce((n, p) => n + p.price * p.quantity, 0);
  return (
    <>
      <div className="sneaker-card-grid">
        {visible.map((variants) => (
          <ProductCard
            key={variants[0].color}
            variants={variants}
            basket={basket}
            change={change}
          />
        ))}
      </div>
      {!visible.length && (
        <div className="checkout-empty">
          <ShoppingBag size={30} />
          <h2>No sneakers match your search</h2>
          <p>Try a color or EU size 38, 39 or 40.</p>
        </div>
      )}
      <div className="catalog-cart-bar">
        <div>
          <ShoppingBag size={22} />
          <div>
            <strong>
              {count
                ? `${count} pairs in your cart`
                : "Your next restock starts here"}
            </strong>
            <small>
              {count
                ? `${lines.length} size / color variants · ${money(subtotal)} MMK`
                : "Choose your colors and sizes, then review your cart."}
            </small>
          </div>
        </div>
        <button className="button primary" disabled={!count} onClick={viewCart}>
          View cart{count > 0 ? ` (${count})` : ""}
        </button>
      </div>
    </>
  );
}
