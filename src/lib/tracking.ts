import { z } from "zod";
import { locationSchema } from "./contact";

export const locationUpdateSchema = z
  .object({
    attemptId: z.string().uuid(),
    state: z.enum(["sharing", "paused", "unavailable"]),
    point: locationSchema
      .extend({
        accuracy: z.number().finite().min(0).max(100_000),
        capturedAt: z.string().datetime({ offset: true }),
      })
      .optional(),
  })
  .refine((value) => value.state !== "sharing" || !!value.point, {
    message: "A fresh GPS position is required to share location.",
  });

export interface DeliveryTracking {
  orderId: string;
  reference: string;
  status: string;
  attemptId: string | null;
  driverId: string | null;
  pickedUpAt: string | null;
  canPublish: boolean;
  state: "awaiting_pickup" | "unavailable" | "sharing" | "paused" | "stopped";
  source: { name: string; pin: { latitude: number; longitude: number } | null };
  destination: { latitude: number; longitude: number } | null;
  point: {
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
    receivedAt: string;
  } | null;
  run?: {
    stops: {
      position: number;
      own: boolean;
      pin: { latitude: number; longitude: number };
      // Supplied only to HQ and the assigned driver, never another customer.
      orderId?: string;
      reference?: string;
      business?: string;
      status?: string;
    }[];
    publisher?: {
      orderId: string;
      attemptId: string;
      reference: string;
    } | null;
  };
}

export const LOCATION_CADENCE_MS = 10_000;
export const LOCATION_STALE_MS = 60_000;
export function locationIsFresh(value: DeliveryTracking, now = Date.now()) {
  return (
    value.canPublish &&
    value.state === "sharing" &&
    !!value.point &&
    now - Date.parse(value.point.capturedAt) < LOCATION_STALE_MS &&
    Date.parse(value.point.capturedAt) <= now + 5_000
  );
}
