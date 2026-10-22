"use client";

import Image from "next/image";
import { Package, RefreshCw, Search } from "lucide-react";
import { productPhoto } from "@/lib/checkout";
import type { Product, WorkspaceData } from "@/lib/domain";

export function BranchStock({
  data,
  branchId,
  search,
  onSearch,
  refresh,
  refreshing,
}: {
  data: WorkspaceData;
  branchId: string | null | undefined;
  search: string;
  onSearch: (value: string) => void;
  refresh: () => void;
  refreshing: boolean;
}) {
  const branch = data.branches.find((item) => item.id === branchId);
  if (!branch || !branch.inventory) {
    return (
      <section className="panel info-pad" aria-label="Branch product stock">
        <h2>Product stock unavailable</h2>
        <p>Your branch inventory could not be loaded. Refresh to try again.</p>
        <button
          className="button secondary"
          onClick={refresh}
          disabled={refreshing}
        >
          Refresh stock
        </button>
      </section>
    );
  }
  const inventory = new Map(
    branch.inventory.map((item) => [item.productId, item]),
  );
  const rows = data.products.map((product) => {
    const item = inventory.get(product.id);
    const onHand = item?.onHand ?? 0;
    const allocated = item?.allocated ?? 0;
    const backup = item?.protected ?? 0;
    return {
      product,
      onHand,
      allocated,
      backup,
      retail: Math.max(0, onHand - allocated - backup),
      available: Math.max(0, onHand - allocated),
    };
  });
  const totals = rows.reduce(
    (sum, row) => ({
      available: sum.available + row.available,
      retail: sum.retail + row.retail,
      backup: sum.backup + row.backup,
      allocated: sum.allocated + row.allocated,
    }),
    { available: 0, retail: 0, backup: 0, allocated: 0 },
  );
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(({ product: p }) =>
    `${p.name} ${p.brand} ${p.color} ${p.size} ${p.pack}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <section
      className="panel branch-product-stock"
      aria-labelledby="branch-stock-title"
    >
      <div className="branch-stock-heading">
        <div>
          <p className="greeting">{branch.name}</p>
          <h2 id="branch-stock-title">Available product stock</h2>
          <p>
            Available pairs include retail stock and wholesale backup. Allocated
            pairs are already committed to deliveries.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh stock"}
        </button>
      </div>
      <dl className="branch-stock-totals">
        {(
          [
            ["Available pairs", totals.available],
            ["Retail available", totals.retail],
            ["Wholesale backup", totals.backup],
            ["Allocated to deliveries", totals.allocated],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value.toLocaleString()} <small>pairs</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className="branch-stock-search">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search branch products</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search product, color or size…"
          />
        </label>
        <span>
          {filtered.length} of {rows.length} variants
        </span>
      </div>
      {filtered.length ? (
        <div
          className="table-scroll"
          role="region"
          aria-label="Product stock by size and color"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Product / variant</th>
                <th>Available</th>
                <th>Retail</th>
                <th>Wholesale backup</th>
                <th>Allocated</th>
                <th>On hand</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(
                ({ product, available, retail, backup, allocated, onHand }) => (
                  <tr key={product.id}>
                    <td>
                      <StockProduct product={product} />
                    </td>
                    <td>
                      <strong className="branch-stock-available">
                        {available} pairs
                      </strong>
                      <small>
                        {available === 0
                          ? "Out of stock"
                          : available < 10
                            ? "Low stock"
                            : "In stock"}
                      </small>
                    </td>
                    <td>{retail} pairs</td>
                    <td>{backup} pairs</td>
                    <td>{allocated} pairs</td>
                    <td>{onHand} pairs</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="branch-stock-empty">
          <Package size={28} aria-hidden="true" />
          <h3>{rows.length ? "No matching products" : "No products yet"}</h3>
          <p>
            {rows.length
              ? "Try another product name, color or size."
              : "Products will appear here when HQ adds them to the catalog."}
          </p>
        </div>
      )}
      <p className="branch-stock-footnote">
        Stock is shown for this branch only. Incoming refills are added after
        your branch confirms receipt.
      </p>
    </section>
  );
}

function StockProduct({ product }: { product: Product }) {
  return (
    <div className="branch-stock-product">
      <Image
        src={productPhoto(product.color)}
        alt={`${product.color} ${product.name}`}
        width={64}
        height={48}
      />
      <div>
        <strong>{product.name}</strong>
        <small>
          {product.color} · EU {product.size}
        </small>
      </div>
    </div>
  );
}
