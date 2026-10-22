// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DeliveryGroupPlanner } from "../src/components/delivery-group-planner";
import type { DispatchCandidates } from "../src/lib/delivery-groups";

vi.mock("../src/components/location-picker", () => ({
  LocationPicker: ({ onChange }: any) => (
    <button onClick={() => onChange({ latitude: 16.8, longitude: 96.1 })}>
      Choose dispatch pin
    </button>
  ),
}));
let root: Root,
  host: HTMLDivElement,
  client: QueryClient,
  data: DispatchCandidates;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data = {
    orders: [
      {
        id: "far",
        reference: "OPL-FAR",
        business: "Far shop",
        sourceBranchId: null,
        sourceName: "HQ",
        sourcePin: null,
        pin: { latitude: 16.83, longitude: 96.1 },
      },
      {
        id: "near",
        reference: "OPL-NEAR",
        business: "Near shop",
        sourceBranchId: null,
        sourceName: "HQ",
        sourcePin: null,
        pin: { latitude: 16.81, longitude: 96.1 },
      },
    ],
    drivers: [],
  };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  client.setQueryData(["dispatch-candidates", "hq"], data);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DeliveryGroupPlanner viewer={{ id: "hq", name: "HQ", role: "hq" }} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    host
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((input) => input.click());
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
function sequence() {
  return [...host.querySelectorAll(".group-stop-list strong")].map(
    (n) => n.textContent,
  );
}

it("explains a missing HQ pin, then visibly reorders and identifies the first drop-off", async () => {
  await render();
  await click("Suggest nearest stops");
  expect(host.textContent).toContain(
    "Choose the dispatch starting point on the map first.",
  );
  expect(sequence()).toEqual(["Far shop", "Near shop"]);
  await click("Choose dispatch pin");
  await click("Suggest nearest stops");
  expect(sequence()).toEqual(["Near shop", "Far shop"]);
  expect(host.textContent).toContain(
    "Sequence updated. First drop-off: Near shop (OPL-NEAR).",
  );
  await click("Suggest nearest stops");
  expect(host.textContent).toContain("Already in nearest-stop order.");
  await click("Clear selection");
  expect(host.textContent).not.toContain("Already in nearest-stop order.");
});

it("uses the saved branch pin without asking for another, and clears stale feedback on manual reorder", async () => {
  data.orders.forEach((o) => {
    o.sourceBranchId = "branch";
    o.sourcePin = { latitude: 16.8, longitude: 96.1 };
  });
  await render();
  expect(host.textContent).not.toContain("Choose dispatch pin");
  await click("Suggest nearest stops");
  expect(sequence()).toEqual(["Near shop", "Far shop"]);
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Move stop 1 later"]')!
      .click(),
  );
  expect(sequence()).toEqual(["Far shop", "Near shop"]);
  expect(host.textContent).not.toContain("Sequence updated.");
});
