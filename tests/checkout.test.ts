import { expect, it } from "vitest";
import { cartError, cartLines } from "../src/lib/checkout";
import { demoData } from "../src/lib/demo-data";

const products = demoData.products.map((product) => ({
  ...product,
  stock: 100,
}));
const first = products[0];
it("keeps the size/color variants and line prices in cart review", () => {
  const second = products.find((p) => p.color !== first.color)!;
  const lines = cartLines(products, { [first.id]: 2, [second.id]: 4 });
  expect(lines.map((p) => [p.id, p.size, p.color, p.quantity])).toEqual([
    [first.id, first.size, first.color, 2],
    [second.id, second.size, second.color, 4],
  ]);
  expect(lines.reduce((n, p) => n + p.price * p.quantity, 0)).toBe(
    first.price * 2 + second.price * 4,
  );
});
it("blocks checkout for empty, discontinued, fractional, odd and over-stock carts", () => {
  expect(cartError(products, {})).toMatch(/Add products/);
  expect(cartError(products, { missing: 2 })).toMatch(/no longer/);
  for (const quantity of [1, 2.5, 3])
    expect(cartError(products, { [first.id]: quantity })).toMatch(/multiples/);
  expect(cartError(products, { [first.id]: first.stock + 2 })).toMatch(
    /available/,
  );
  expect(cartError(products, { [first.id]: 2 })).toBeNull();
});
