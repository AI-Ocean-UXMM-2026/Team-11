"use client";
import { useState } from "react";
import { phoneInputValue } from "@/lib/contact";
import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

const names = new Intl.DisplayNames(["en"], { type: "region" });
const countries = getCountries()
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function PhoneField({ label = "Contact number" }: { label?: string }) {
  const [country, setCountry] = useState<CountryCode>("MM");
  const [national, setNational] = useState("");
  return (
    <fieldset className="phone-field">
      <legend>{label}</legend>
      <div className="phone-inputs">
        <label className="field">
          <span className="sr-only">Country calling code</span>
          <select
            name="phoneCountry"
            aria-label="Country calling code"
            value={country}
            onChange={(e) => {
              const nextCountry = e.target.value as CountryCode;
              setCountry(nextCountry);
              setNational(phoneInputValue(national, nextCountry).national);
            }}
            autoComplete="tel-country-code"
          >
            {countries.map(({ code, name }) => (
              <option key={code} value={code}>
                {name} (+{getCountryCallingCode(code)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">{label}</span>
          <div className="phone-number-input">
            <span aria-hidden="true" className="phone-prefix">
              +{getCountryCallingCode(country)}
            </span>
            <input
              name="phone"
              type="tel"
              aria-label={label}
              autoComplete="tel-national"
              required
              maxLength={30}
              placeholder={country === "MM" ? "9 123 456 789" : "Phone number"}
              value={national}
              onChange={(e) => {
                const next = phoneInputValue(e.target.value, country);
                setCountry(next.country);
                setNational(next.national);
              }}
            />
          </div>
        </label>
      </div>
      <small>
        {country === "MM"
          ? "Enter 9… without the leading 0. Saved as +95 9…."
          : `Country code +${getCountryCallingCode(country)} is already included.`}{" "}
        You can also paste a full international number.
      </small>
    </fieldset>
  );
}
