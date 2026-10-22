import { expect, it } from "vitest";
import {
  suggestStopOrder,
  type DispatchCandidate,
} from "../src/lib/delivery-groups";

const start = { latitude: 16.8, longitude: 96.1 };
function order(id: string, offset: number): DispatchCandidate {
  return {
    id,
    reference: id,
    business: id,
    sourceBranchId: null,
    sourceName: "HQ",
    sourcePin: null,
    pin: { latitude: start.latitude + offset, longitude: start.longitude },
  };
}

it("chooses the first drop-off from the dispatch point, not selection order", () => {
  const selected = [
    order("far", 0.03),
    order("near", 0.01),
    order("middle", 0.02),
  ];
  expect(suggestStopOrder(selected, start).map((o) => o.id)).toEqual([
    "near",
    "middle",
    "far",
  ]);
  expect(selected.map((o) => o.id)).toEqual(["far", "near", "middle"]);
});

it("uses a saved branch pin and preserves an already nearest-stop sequence", () => {
  const selected = [order("near", 0.01), order("far", 0.03)];
  selected[0].sourcePin = start;
  expect(suggestStopOrder(selected).map((o) => o.id)).toEqual(["near", "far"]);
});

it("requires a real starting point instead of silently keeping the first selection", () => {
  expect(() =>
    suggestStopOrder([order("far", 0.03), order("near", 0.01)]),
  ).toThrow("Choose a dispatch starting point first.");
  expect(suggestStopOrder([])).toEqual([]);
});
