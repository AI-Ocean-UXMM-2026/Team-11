"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { Viewer } from "@/lib/domain";
import { LOCATION_CADENCE_MS, type DeliveryTracking } from "@/lib/tracking";
import {
  readTracking,
  sendLocation,
  subscribeTracking,
  TrackingRequestError,
} from "@/lib/tracking-client";

type Trip = {
  orderId: string;
  attemptId: string;
  viewerId: string;
  demo: boolean;
  reference: string;
};
type Context = {
  trip: Trip | null;
  message: string;
  paused: boolean;
  begin: (trip: Trip) => void;
  pause: () => void;
  resume: () => void;
  end: () => void;
  identify: (viewer: Viewer) => void;
};
const DriverContext = createContext<Context | null>(null);
export function useDriverTracking() {
  const context = useContext(DriverContext);
  if (!context) throw new Error("Driver tracking provider is missing.");
  return context;
}

// Lives above portal pages so closing a dialog or changing sections keeps GPS on.
// Consent is memory-only: a reload requires an explicit resume action.
export function DriverTrackingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [paused, setPaused] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [eligible, setEligible] = useState(true);
  const [message, setMessage] = useState("");
  const current = useRef(trip);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  function send(orderId: string, update: unknown, signal?: AbortSignal) {
    const request = writes.current
      .catch(() => {})
      .then(() => sendLocation(orderId, update, signal));
    writes.current = request;
    return request;
  }
  current.current = trip;
  const inDriverPortal =
    pathname.startsWith("/driver") && !pathname.startsWith("/driver/login");
  useEffect(() => {
    const sync = () => setForeground(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => {
    if (!inDriverPortal) setTrip(null);
  }, [inDriverPortal]);
  useEffect(() => {
    if (!trip || !inDriverPortal) return;
    let disposed = false;
    let reading = false;
    let again = false;
    const accept = (next: DeliveryTracking) => {
      if (disposed) return;
      if (next.driverId !== trip.viewerId && !trip.demo) {
        setTrip(null);
        return;
      }
      if (
        next.attemptId !== trip.attemptId ||
        next.state === "stopped" ||
        (!next.canPublish &&
          next.run?.publisher &&
          next.run.publisher.orderId !== trip.orderId)
      ) {
        if (
          next.run?.publisher &&
          next.run.publisher.orderId !== trip.orderId
        ) {
          setTrip({ ...trip, ...next.run.publisher });
          setMessage(
            "Continuing location sharing for the remaining picked-up deliveries.",
          );
          return;
        }
        setMessage("Location sharing ended for this delivery.");
        setTrip(null);
        return;
      }
      setEligible(next.canPublish);
      if (!next.canPublish)
        setMessage(
          "Location sharing is paused while this delivery is on hold.",
        );
    };
    const refresh = async () => {
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        accept(await readTracking(trip.orderId));
      } catch (error) {
        if (
          !disposed &&
          error instanceof TrackingRequestError &&
          [401, 403].includes(error.status)
        )
          setTrip(null);
      } finally {
        reading = false;
        if (again && !disposed) {
          again = false;
          void refresh();
        }
      }
    };
    const unsubscribe = subscribeTracking(
      trip.orderId,
      trip.demo,
      () => {
        void refresh();
      },
      () => {},
    );
    void refresh();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [trip, inDriverPortal]);

  useEffect(() => {
    if (!trip || !inDriverPortal) return;
    const session = trip;
    let disposed = false;
    let watch: number | undefined;
    let inFlight = false;
    let lastSent = 0;
    const abort = new AbortController();
    const active = !paused && foreground && eligible;
    const fail = (error: unknown) => {
      if (disposed) return;
      if (
        error instanceof TrackingRequestError &&
        [401, 403].includes(error.status)
      ) {
        setTrip(null);
        setMessage("Sign in again before sharing location.");
        return;
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Location unavailable. Manual delivery updates remain available.",
      );
      if (error instanceof TrackingRequestError && error.status === 409) {
        void readTracking(session.orderId)
          .then((value) => {
            if (!disposed) {
              setEligible(value.canPublish);
              if (
                !value.canPublish &&
                value.run?.publisher &&
                value.run.publisher.orderId !== session.orderId
              ) {
                setTrip({ ...session, ...value.run.publisher });
                return;
              }
              if (
                value.state === "stopped" ||
                value.attemptId !== session.attemptId
              )
                setTrip(null);
            }
          })
          .catch(() => {});
      }
    };
    if (!active) {
      setMessage((previous) =>
        paused && previous.includes("permission denied")
          ? previous
          : !foreground
            ? "Location sharing paused. Return to this page to resume."
            : paused
              ? "Location sharing paused."
              : "Delivery on hold. Location sharing paused.",
      );
      void send(session.orderId, {
        attemptId: session.attemptId,
        state: "paused",
      }).catch(() => {});
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage(
        "GPS needs a supported browser on HTTPS. You can still update delivery status.",
      );
      return;
    }
    setMessage(
      "Waiting for a fresh GPS location… Keep Supply Link open during delivery.",
    );
    void send(session.orderId, {
      attemptId: session.attemptId,
      state: "unavailable",
    }).catch(fail);
    const position = async (fix: GeolocationPosition) => {
      if (
        disposed ||
        document.visibilityState === "hidden" ||
        inFlight ||
        Date.now() - lastSent < LOCATION_CADENCE_MS
      )
        return;
      if (
        !Number.isFinite(fix.timestamp) ||
        Date.now() - fix.timestamp > 60_000
      )
        return;
      inFlight = true;
      try {
        const next = await send(
          session.orderId,
          {
            attemptId: session.attemptId,
            state: "sharing",
            point: {
              latitude: fix.coords.latitude,
              longitude: fix.coords.longitude,
              accuracy: fix.coords.accuracy,
              capturedAt: new Date(fix.timestamp).toISOString(),
            },
          },
          abort.signal,
        );
        if (!disposed) {
          lastSent = Date.now();
          setEligible(next.canPublish);
          setMessage(
            "Live location is being shared with HQ and the customers of your picked-up deliveries. Keep Supply Link open.",
          );
        }
      } catch (error) {
        fail(error);
      } finally {
        inFlight = false;
      }
    };
    const gpsError = (error: GeolocationPositionError) => {
      if (disposed) return;
      setMessage(
        error.code === 1
          ? "GPS permission denied. Allow location in your browser, then resume sharing."
          : "GPS location is unavailable. Waiting for a fresh position.",
      );
      void send(session.orderId, {
        attemptId: session.attemptId,
        state: "unavailable",
      }).catch(() => {});
      if (error.code === 1) setPaused(true);
    };
    const startWatch = () => {
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      lastSent = 0;
      watch = navigator.geolocation.watchPosition(
        (fix) => {
          void position(fix);
        },
        gpsError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    };
    const offline = () => {
      setMessage(
        "You’re offline. Location updates will resume after reconnecting.",
      );
    };
    window.addEventListener("online", startWatch);
    window.addEventListener("offline", offline);
    const pageHide = () => {
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      void send(session.orderId, {
        attemptId: session.attemptId,
        state: "paused",
      }).catch(() => {});
    };
    window.addEventListener("pagehide", pageHide);
    startWatch();
    return () => {
      disposed = true;
      abort.abort();
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      window.removeEventListener("online", startWatch);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pageHide);
      void send(session.orderId, {
        attemptId: session.attemptId,
        state: "paused",
      }).catch(() => {});
    };
  }, [trip, paused, foreground, eligible, inDriverPortal]);

  return (
    <DriverContext.Provider
      value={{
        trip: inDriverPortal ? trip : null,
        message,
        paused,
        begin: (next) => {
          setEligible(true);
          setPaused(false);
          setMessage("");
          setTrip(next);
        },
        pause: () => setPaused(true),
        resume: () => setPaused(false),
        end: () => setTrip(null),
        identify: (viewer) => {
          if (current.current && current.current.viewerId !== viewer.id)
            setTrip(null);
        },
      }}
    >
      {children}
    </DriverContext.Provider>
  );
}
