"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import type { WorkspaceData } from "@/lib/domain";
import type { WorkspaceQuery } from "@/lib/workflow/query";
import { pinFromForm } from "@/lib/contact";
import { saveSmeDeliveryLocation } from "@/app/actions";
import { LocationPicker } from "./location-picker";

export function SmeLocationSettings({
  profile,
  query,
  updated,
}: {
  profile: WorkspaceData["profile"];
  query: WorkspaceQuery;
  updated: (data: WorkspaceData, message?: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [address, setAddress] = useState(profile?.address ?? "");

  async function submit(form: HTMLFormElement) {
    if (pending) return;
    const values = new FormData(form);
    const pin = pinFromForm(values);
    if (!pin) {
      setError("Choose your delivery location on the map.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await saveSmeDeliveryLocation(
        { address: values.get("address"), pin },
        query,
      );
      if (result.error || !result.data) {
        setError(result.error ?? "Could not save your delivery location.");
        return;
      }
      await updated(result.data, "Default delivery location saved.");
    } catch {
      setError("Could not save your delivery location. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel sme-location-settings">
      <div className="panel-heading">
        <div>
          <h2>Default delivery location</h2>
          <p className="muted">
            Orders start with this saved address and map pin. You can still
            change the delivery details for an individual order.
          </p>
        </div>
        <MapPin size={20} aria-hidden="true" />
      </div>
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <label className="field">
          Full delivery address
          <textarea
            name="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
            minLength={5}
            maxLength={300}
            autoComplete="street-address"
            placeholder="Street, building, township, city"
          />
        </label>
        <LocationPicker
          required
          label="Default map location"
          initialPin={profile?.pin ?? undefined}
          addressValue={address}
          onAddressChange={setAddress}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Saving location…" : "Save default location"}
        </button>
      </form>
    </section>
  );
}
