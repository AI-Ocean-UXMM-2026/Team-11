import type { Product } from "./domain";

export type Cart = Record<string, number>;
export function cartLines(products: Product[], cart: Cart) {
  return products
    .filter((p) => cart[p.id] > 0)
    .map((p) => ({ ...p, quantity: cart[p.id] }));
}
export function cartError(products: Product[], cart: Cart): string | null {
  const ids = Object.keys(cart).filter((id) => cart[id] > 0);
  if (!ids.length) return "Add sneakers to your cart to continue.";
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
      return `Choose ${p.color} sneakers in EU ${p.size} in multiples of ${p.minimum} pairs.`;
    if (quantity > p.stock)
      return `Only ${p.stock} pairs of ${p.color} sneakers in EU ${p.size} are available. Update your cart.`;
  }
  return null;
}
export const productPhoto = (color: string) =>
  `/products/stt-${color.toLowerCase()}.png`;
