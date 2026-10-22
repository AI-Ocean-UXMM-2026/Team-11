"use client";
import { useState } from "react";
import Image from "next/image";
import { Check, Plus, ShoppingBag } from "lucide-react";
import { money, type Product } from "@/lib/domain";
import {
  cartLines,
  productPhoto,
  productUnit,
  type Cart,
} from "@/lib/checkout";

function ProductCard({
  product,
  basket,
  change,
}: {
  product: Product;
  basket: Cart;
  change: (cart: Cart) => void;
}) {
  const [quantity, setQuantity] = useState(product.minimum);
  const [added, setAdded] = useState("");
  const available = Math.max(0, product.stock - (basket[product.id] ?? 0));
  const unit = productUnit(product);
  const valid =
    Number.isInteger(quantity) &&
    quantity >= product.minimum &&
    quantity % product.minimum === 0 &&
    quantity <= available;
  return (
    <article className="catalog-product-card product-card">
      <div className="catalog-product-photo product-photo">
        <Image
          src={productPhoto(product)}
          alt={`${product.name}, ${product.pack}`}
          width={800}
          height={800}
          sizes="(max-width: 600px) 100vw, (max-width: 1000px) 45vw, 30vw"
        />
        <span className="catalog-product-color">{product.pack}</span>
      </div>
      <div className="catalog-product-card-body">
        <div className="catalog-product-card-heading">
          <div>
            <p>{product.category}</p>
            <h2>{product.name}</h2>
          </div>
          <p className="catalog-product-unit-price">
            <strong>{money(product.price)}</strong> MMK <span>/ {unit}</span>
          </p>
        </div>
        <p className="catalog-product-description">{product.pack}</p>
        <div className="catalog-product-selection product-selection">
          <label className="field">
            Quantity ({unit}s)
            <input
              aria-label={`${product.name} ${product.pack} quantity`}
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
                `${quantity} ${unit}${quantity === 1 ? "" : "s"} added to cart.`,
              );
            }}
          >
            <Plus size={17} />
            Add to cart
          </button>
        </div>
        <p className="catalog-product-stock">
          {available} {unit}
          {available === 1 ? "" : "s"} available · Minimum {product.minimum}
        </p>
        <p className="catalog-product-added" role="status">
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
  const visible = products.filter((product) =>
    `${product.name} ${product.category} ${product.pack} ${product.sku ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const lines = cartLines(products, basket),
    count = lines.reduce((n, p) => n + p.quantity, 0),
    subtotal = lines.reduce((n, p) => n + p.price * p.quantity, 0);
  const units = [...new Set(lines.map((line) => productUnit(line)))];
  const cartUnit = units.length === 1 ? units[0] : "items";
  return (
    <>
      <div className="catalog-product-card-grid product-card-grid">
        {visible.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            basket={basket}
            change={change}
          />
        ))}
      </div>
      {!visible.length && (
        <div className="checkout-empty">
          <ShoppingBag size={30} />
          <h2>No products match your search</h2>
          <p>Try searching by product name or style.</p>
        </div>
      )}
      <div className="catalog-cart-bar">
        <div>
          <ShoppingBag size={22} />
          <div>
            <strong>
              {count
                ? `${count} ${cartUnit} in your cart`
                : "Your order starts here"}
            </strong>
            <small>
              {count
                ? `${lines.length} product styles · ${money(subtotal)} MMK`
                : "Choose products, then review your cart."}
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
