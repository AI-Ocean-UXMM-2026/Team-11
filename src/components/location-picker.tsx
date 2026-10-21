"use client";
import { useState } from "react";
import type { LocationPin } from "@/lib/contact";
import { pinFromMapbox } from "@/lib/maps";
import { LocationMap } from "./location-map";

export function LocationPicker({
  required = false,
  initialPin,
  label = "Location pin",
}: {
  required?: boolean;
  initialPin?: LocationPin;
  label?: string;
}) {
  const [pin, setPin] = useState<LocationPin | undefined>(initialPin);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  function select(next: LocationPin) {
    setPin(next);
    setMessage("");
  }
  function locate() {
    if (!navigator.geolocation) {
      setMessage(
        "Location access is unavailable. Choose a location on the map.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = pinFromMapbox({
          lat: coords.latitude,
          lng: coords.longitude,
        });
        if (point) select(point);
        else
          setMessage(
            "Your location could not be determined. Choose a location on the map.",
          );
        setLocating(false);
      },
      () => {
        setMessage(
          "Location access was unavailable. Choose a location on the map.",
        );
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
    );
  }
  return (
    <fieldset className="location-picker">
      <legend>
        {label}
        {required ? " *" : " (optional)"}
      </legend>
      <p className="muted">
        Tap the map or drag the pin to the exact location.
      </p>
      <LocationMap pin={pin} label={label} select={select} />
      <button
        type="button"
        className="button secondary"
        disabled={locating}
        onClick={locate}
      >
        {locating ? "Finding location…" : "Use current location"}
      </button>
      <input name="latitude" type="hidden" value={pin?.latitude ?? ""} />
      <input name="longitude" type="hidden" value={pin?.longitude ?? ""} />
      <p className="location-selection" role="status">
        {pin ? "Location selected" : "Choose a location on the map"}
      </p>
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
    </fieldset>
  );
}
