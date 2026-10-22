// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BranchStock } from "../src/components/branch-stock";
import { demoData } from "../src/lib/demo-data";
import type { WorkspaceData } from "../src/lib/domain";

let root: Root, host: HTMLDivElement;
const refresh = vi.fn();
const onSearch = vi.fn();
const product = {
  ...demoData.products[0],
  id: "white-40",
  category: "Longyi",
  color: "White",
  size: "40",
  pack: "White · EU 40 · 1 pair",
  stock: 9000,
  reserve: 0,
};
const data: WorkspaceData = {
  ...demoData,
  products: [
    product,
    {
      ...product,
      id: "black-38",
      color: "Black",
      size: "38",
      pack: "Black · EU 38 · 1 pair",
    },
  ],
  branches: [
    {
      ...demoData.branches[0],
      id: "own",
      name: "Own branch",
      inventory: [
        {
          productId: "white-40",
          variant: "White 40",
          onHand: 60,
          allocated: 10,
          protected: 30,
        },
      ],
    },
    {
      ...demoData.branches[0],
      id: "other",
      name: "Other branch",
      inventory: [
        {
          productId: "white-40",
          variant: "White 40",
          onHand: 8888,
          allocated: 0,
          protected: 0,
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  refresh.mockReset();
  onSearch.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(search = "", branchId = "own") {
  await act(async () =>
    root.render(
      <BranchStock
        data={data}
        branchId={branchId}
        search={search}
        onSearch={onSearch}
        refresh={refresh}
        refreshing={false}
      />,
    ),
  );
}
it("separates available stock from committed deliveries and wholesale backup for the signed-in branch", async () => {
  await render();
  const rows = host.querySelectorAll("tbody tr");
  expect(
    Array.from(rows[0].querySelectorAll("td"))
      .slice(1)
      .map((cell) => cell.textContent),
  ).toEqual([
    "50 piecesIn stock",
    "20 pieces",
    "30 pieces",
    "10 pieces",
    "60 pieces",
  ]);
  expect(rows[1].textContent).toContain("Out of stock");
  expect(host.textContent).not.toContain("8888");
  expect(host.textContent).not.toContain("9000");
  expect(host.textContent).not.toContain("Other branch");
  await act(async () =>
    (host.querySelector("button") as HTMLButtonElement).click(),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
it("searches styles without changing branch-wide totals", async () => {
  await render("black 38");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.querySelector("tbody")?.textContent).toContain("Black · EU 38");
  expect(host.querySelector("dl")?.textContent).toContain(
    "Available stock50 pieces",
  );
  await render("missing size");
  expect(host.textContent).toContain("No matching products");
});
it("does not fall back to another branch or HQ stock if branch data is unavailable", async () => {
  await render("", "missing");
  expect(host.textContent).toContain("Product stock unavailable");
  expect(host.querySelector("table")).toBeNull();
});
