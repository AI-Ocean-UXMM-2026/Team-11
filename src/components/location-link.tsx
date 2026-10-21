"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { LocationPin } from "@/lib/contact";
import { LocationMap } from "./location-map";

function MapPreview({
  pin,
  title,
  close,
}: {
  pin: LocationPin;
  title: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal map-preview"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close location map"
        >
          <X size={20} />
        </button>
      </div>
      <div className="map-preview-body">
        <LocationMap pin={pin} label={title} />
      </div>
    </dialog>,
    document.body,
  );
}

export function LocationLink({
  pin,
  title = "Saved location",
  label = "View location pin",
}: {
  pin: LocationPin;
  title?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pin-link" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <MapPreview pin={pin} title={title} close={() => setOpen(false)} />
      )}
    </>
  );
}
