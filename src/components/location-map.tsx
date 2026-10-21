"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import {
  MAPBOX_STYLE,
  YANGON_CENTER,
  publicMapboxToken,
  mapboxCoordinates,
  pinFromMapbox,
} from "@/lib/maps";
import type { LocationPin } from "@/lib/contact";
import "mapbox-gl/dist/mapbox-gl.css";

export function LocationMap({
  pin,
  label,
  select,
  pinLabel = "Saved location",
  pinColor = "#17674f",
  markers,
}: {
  pin?: LocationPin;
  label: string;
  select?: (pin: LocationPin) => void;
  pinLabel?: string;
  pinColor?: string;
  markers?: { id: string; pin: LocationPin; label: string; color: string }[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapboxMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const sdk = useRef<typeof import("mapbox-gl").default | null>(null);
  const framed = useRef(false);
  const selection = useRef(select);
  const currentPin = useRef(pin);
  selection.current = select;
  currentPin.current = pin;
  const editable = !!select;
  const token = publicMapboxToken();
  const [ready, setReady] = useState(0);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const helpId = useId();
  useEffect(() => {
    if (!token || !container.current) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    setLoaded(false);
    setMessage("");
    void import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (disposed || !container.current) return;
        if (!mapboxgl.supported()) {
          setMessage("Interactive maps are unavailable on this device.");
          return;
        }
        const map = new mapboxgl.Map({
          container: container.current,
          accessToken: token,
          style: MAPBOX_STYLE,
          center: currentPin.current
            ? mapboxCoordinates(currentPin.current)
            : YANGON_CENTER,
          zoom: currentPin.current ? 15 : 12,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        instance.current = map;
        sdk.current = mapboxgl;
        framed.current = false;
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          "top-left",
        );
        map.addControl(new mapboxgl.FullscreenControl(), "top-right");
        marker.current = new mapboxgl.Marker({
          color: pinColor,
          draggable: editable,
        });
        marker.current
          .getElement()
          .setAttribute(
            "aria-label",
            editable ? "Selected location — drag to move" : pinLabel,
          );
        marker.current.on("dragend", () => {
          const next = pinFromMapbox(marker.current!.getLngLat());
          if (next) selection.current?.(next);
        });
        if (editable) {
          map.on("click", (event) => {
            const next = pinFromMapbox(event.lngLat);
            if (next) selection.current?.(next);
          });
          // Keyboard placement without adding another visible map-center button.
          map.getCanvas().addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const next = pinFromMapbox(map.getCenter());
            if (next) selection.current?.(next);
          });
        }
        map.on("load", () => {
          if (!disposed) {
            setLoaded(true);
            setMessage("");
          }
        });
        map.on("error", () => {
          if (!disposed) {
            setLoaded(true);
            setMessage(
              "Mapbox could not load. Check the map token and connection, then reload the page.",
            );
          }
        });
        observer = new ResizeObserver(() => map.resize());
        observer.observe(container.current);
        setReady((version) => version + 1);
      })
      .catch(() => {
        if (!disposed) {
          setLoaded(true);
          setMessage(
            "Mapbox could not start. Reload the page or try another browser.",
          );
        }
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      marker.current?.remove();
      instance.current?.remove();
      marker.current = null;
      instance.current = null;
    };
  }, [token, editable, pinColor]);
  const markerKey = JSON.stringify(markers ?? []);
  useEffect(() => {
    const map = instance.current,
      mapboxgl = sdk.current;
    if (!map || !mapboxgl) return;
    const entries: NonNullable<typeof markers> = JSON.parse(markerKey);
    const points = entries.map((entry) => {
      const point = new mapboxgl.Marker({ color: entry.color })
        .setLngLat(mapboxCoordinates(entry.pin))
        .addTo(map);
      point.getElement().setAttribute("aria-label", entry.label);
      return point;
    });
    if (entries.length && !framed.current && currentPin.current) {
      const coordinates = [
        mapboxCoordinates(currentPin.current),
        ...entries.map((entry) => mapboxCoordinates(entry.pin)),
      ];
      map.fitBounds(
        [
          [
            Math.min(...coordinates.map((c) => c[0])),
            Math.min(...coordinates.map((c) => c[1])),
          ],
          [
            Math.max(...coordinates.map((c) => c[0])),
            Math.max(...coordinates.map((c) => c[1])),
          ],
        ],
        { padding: 45, maxZoom: 15, duration: 0 },
      );
      framed.current = true;
    }
    return () => points.forEach((point) => point.remove());
  }, [markerKey, ready]);
  useEffect(() => {
    if (!editable)
      marker.current?.getElement().setAttribute("aria-label", pinLabel);
  }, [pinLabel, editable, ready]);
  const latitude = pin?.latitude,
    longitude = pin?.longitude;
  useEffect(() => {
    const map = instance.current,
      point = marker.current;
    if (!map || !point) return;
    if (latitude === undefined || longitude === undefined) {
      point.remove();
      return;
    }
    const coordinates = mapboxCoordinates({ latitude, longitude });
    point.setLngLat(coordinates).addTo(map);
    if (!map.getBounds()?.contains(coordinates))
      map.jumpTo({ center: coordinates });
  }, [latitude, longitude, ready]);
  return (
    <div className="location-map-wrap">
      <div
        ref={container}
        className="location-map"
        role="region"
        aria-label={`${label} Mapbox map`}
        aria-describedby={helpId}
      />
      {!token ? (
        <p className="map-message" role="status">
          Mapbox is not configured yet. Add the public map token to enable the
          map.
        </p>
      ) : message ? (
        <p className="map-message" role="status">
          {message}
        </p>
      ) : !loaded ? (
        <p className="map-message" role="status">
          Loading map…
        </p>
      ) : null}
      <span id={helpId} className="sr-only">
        Use the zoom buttons, pinch, or Control or Command plus scroll to zoom.
        Use two fingers to pan on touch devices or the arrow keys on a keyboard.
        {editable && " Press Enter to place the pin."}
      </span>
    </div>
  );
}
