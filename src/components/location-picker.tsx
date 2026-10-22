"use client";
import { useEffect, useRef, useState } from "react";
import type { LocationPin } from "@/lib/contact";
import { pinFromMapbox, reverseGeocodeMapbox } from "@/lib/maps";
import { LocationMap } from "./location-map";

export function LocationPicker({
  required = false,
  initialPin,
  addressValue,
  label = "Location pin",
  onChange,
  onAddressChange,
}: {
  required?: boolean;
  initialPin?: LocationPin;
  addressValue?: string;
  label?: string;
  onChange?: (pin: LocationPin) => void;
  onAddressChange?: (address: string) => void;
}) {
  const [pin, setPin] = useState<LocationPin | undefined>(initialPin);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [lookingUpAddress, setLookingUpAddress] = useState(false);
  const lookupId = useRef(0);
  const lookupController = useRef<AbortController | null>(null);
  const currentAddress = useRef(addressValue);
  currentAddress.current = addressValue;

  useEffect(
    () => () => {
      lookupController.current?.abort();
    },
    [],
  );

  function select(next: LocationPin) {
    setPin(next);
    const selectionId = ++lookupId.current;
    lookupController.current?.abort();
    lookupController.current = null;
    setMessage(onAddressChange ? "Looking up the address for this pin…" : "");
    onChange?.(next);
    if (!onAddressChange) return;

    const addressAtSelection = currentAddress.current;
    const controller = new AbortController();
    lookupController.current = controller;
    setLookingUpAddress(true);
    void reverseGeocodeMapbox(next, controller.signal)
      .then((address) => {
        if (selectionId !== lookupId.current || controller.signal.aborted)
          return;
        if (!address) {
          setMessage(
            "Address lookup was unavailable. You can enter it manually.",
          );
          return;
        }
        if (currentAddress.current !== addressAtSelection) {
          setMessage("Address left unchanged because it was edited manually.");
          return;
        }
        onAddressChange(address);
        currentAddress.current = address;
        setMessage("Address updated from the pinned location.");
      })
      .catch(() => {
        if (selectionId === lookupId.current && !controller.signal.aborted)
          setMessage("Address lookup failed. You can enter it manually.");
      })
      .finally(() => {
        if (selectionId === lookupId.current) setLookingUpAddress(false);
      });
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
        {lookingUpAddress
          ? "Looking up address…"
          : pin
            ? "Location selected"
            : "Choose a location on the map"}
      </p>
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
    </fieldset>
  );
}
