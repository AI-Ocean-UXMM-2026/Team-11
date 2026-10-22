import type { Product } from "./domain";

export type Cart = Record<string, number>;
export function productUnit(product: Pick<Product, "category">) {
  return product.category.toLowerCase() === "longyi" ? "piece" : "pair";
}
export function variantUnit(variant: string) {
  const match = variant.match(/\b(pieces?|pairs?)\b/i)?.[1]?.toLowerCase();
  return match?.startsWith("piece") ? "piece" : "pair";
}
export function quantityUnit(quantity: number, unit: string) {
  const singular = unit.trim().replace(/s$/i, "");
  return quantity === 1 ? singular : `${singular}s`;
}
export function productPhoto(product: Product | string) {
  if (typeof product !== "string") {
    if (product.imagePath) return product.imagePath;
    if (product.tone.startsWith("/")) return product.tone;
    return "/products/catalog-import/1.2.webp";
  }
  if (product.startsWith("/")) return product;
  return "/products/catalog-import/1.2.webp";
}
export function cartLines(products: Product[], cart: Cart) {
  return products
    .filter((p) => cart[p.id] > 0)
    .map((p) => ({ ...p, quantity: cart[p.id] }));
}
export function cartError(products: Product[], cart: Cart): string | null {
  const ids = Object.keys(cart).filter((id) => cart[id] > 0);
  if (!ids.length) return "Add products to your cart to continue.";
  for (const id of ids) {
    const p = products.find((p) => p.id === id),
      quantity = cart[id];
    if (!p)
      return "An item is no longer in the catalog. Remove it and choose another variant.";
    if (
      !Number.isInteger(quantity) ||
      quantity < p.minimum ||
      quantity % p.minimum !== 0
    )
      return `Choose ${p.name} (${p.pack}) in multiples of ${p.minimum} ${productUnit(p)}${p.minimum === 1 ? "" : "s"}.`;
    if (quantity > p.stock)
      return `Only ${p.stock} ${productUnit(p)}${p.stock === 1 ? "" : "s"} of ${p.name} (${p.pack}) are available. Update your cart.`;
  }
  return null;
}
