"use client";
import type { DeliveryTracking } from "./tracking";

export class TrackingRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function readTracking(
  orderId: string,
  signal?: AbortSignal,
): Promise<DeliveryTracking> {
  const response = await fetch(`/api/orders/${orderId}/tracking`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok || !body.data)
    throw new TrackingRequestError(
      body.error ?? "Location unavailable.",
      response.status,
    );
  return body.data;
}
export async function sendLocation(
  orderId: string,
  update: unknown,
  signal?: AbortSignal,
): Promise<DeliveryTracking> {
  const response = await fetch(`/api/orders/${orderId}/tracking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    cache: "no-store",
    keepalive: true,
  });
  const body = await response.json();
  if (!response.ok || !body.data)
    throw new TrackingRequestError(
      body.error ?? "Location update failed.",
      response.status,
    );
  return body.data;
}

// Subscribe before fetching the snapshot so reconnects cannot miss a transition.
export function subscribeTracking(
  orderId: string,
  demo: boolean,
  changed: () => void,
  connection: (live: boolean) => void,
) {
  let disposed = false;
  let cleanup = () => {};
  if (demo) {
    const events = new EventSource(`/api/orders/${orderId}/tracking/events`);
    events.onopen = () => {
      connection(true);
      changed();
    };
    events.onerror = () => connection(false);
    events.addEventListener("change", changed);
    cleanup = () => events.close();
  } else {
    void import("./supabase/client")
      .then(({ createClient }) => {
        if (disposed) return;
        const client = createClient();
        const channel = client
          .channel(`delivery:${orderId}:${crypto.randomUUID()}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "delivery_tracking",
              filter: `order_id=eq.${orderId}`,
            },
            changed,
          )
          .subscribe((status) => {
            connection(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") changed();
          });
        cleanup = () => {
          void client.removeChannel(channel);
        };
      })
      .catch(() => {
        if (!disposed) connection(false);
      });
  }
  return () => {
    disposed = true;
    cleanup();
  };
}
