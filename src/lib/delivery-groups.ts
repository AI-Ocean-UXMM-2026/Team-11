import type { LocationPin } from "./contact";
import { metresBetween } from "./routing";

export type DispatchCandidate = {
  id: string;
  reference: string;
  business: string;
  sourceBranchId: string | null;
  sourceName: string;
  pin: LocationPin;
  sourcePin: LocationPin | null;
};
export type DispatchCandidates = {
  orders: DispatchCandidate[];
  drivers: { id: string; name: string; branchId: string | null }[];
};

export type DriverDeliveryGroup = {
  id: string;
  sourceName: string;
  acceptedAt: string | null;
  stops: {
    orderId: string;
    attemptId: string;
    position: number;
    reference: string;
    business: string;
    pairs: number;
    status: string;
    pickedUpAt: string | null;
    active: boolean;
    canPickup: boolean;
    canDeliver: boolean;
  }[];
};
export type DriverGroupResult = {
  message: string;
  publisher?: { orderId: string; attemptId: string; reference: string } | null;
};

// A transparent geographic heuristic, not an AI prediction or road-time optimizer.
export function suggestStopOrder(
  orders: DispatchCandidate[],
  start: LocationPin | null = orders[0]?.sourcePin ?? null,
) {
  if (!orders.length) return [];
  if (!start) throw new Error("Choose a dispatch starting point first.");
  const remaining = [...orders];
  const sorted: DispatchCandidate[] = [];
  let origin = start;
  while (remaining.length && origin) {
    remaining.sort(
      (a, b) =>
        metresBetween(origin!, a.pin) - metresBetween(origin!, b.pin) ||
        a.id.localeCompare(b.id),
    );
    const next = remaining.shift()!;
    sorted.push(next);
    origin = next.pin;
  }
  return sorted;
}
