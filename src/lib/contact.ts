import {
  getCountries,
  getCountryCallingCode,
  parseIncompletePhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { z } from "zod";

export function phoneInputValue(value: string, country: CountryCode) {
  let national = parseIncompletePhoneNumber(value);
  const parsed = parsePhoneNumberFromString(national, {
    defaultCountry: country,
    extract: false,
  });
  if (national.startsWith("+")) {
    if (parsed?.country)
      return {
        country: parsed.country,
        national: parsed.nationalNumber.toString(),
      };
    const prefix = `+${getCountryCallingCode(country)}`;
    if (national.startsWith(prefix)) national = national.slice(prefix.length);
    else return { country, national };
  }
  if (country === "MM") national = national.replace(/^0+/, "");
  return { country, national };
}

export function internationalPhone(value: string, country: string = "MM") {
  if (!getCountries().includes(country as CountryCode)) return null;
  const phone = parsePhoneNumberFromString(value, {
    defaultCountry: country as CountryCode,
    extract: false,
  });
  return phone?.isValid() ? phone.number : null;
}

export const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type LocationPin = z.infer<typeof locationSchema>;

export function pinFromForm(form: FormData) {
  const latitude = form.get("latitude"),
    longitude = form.get("longitude");
  if (
    latitude === null ||
    latitude === "" ||
    longitude === null ||
    longitude === ""
  )
    return undefined;
  return { latitude: Number(latitude), longitude: Number(longitude) };
}
