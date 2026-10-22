import { locationSchema, type LocationPin } from "./contact";

export const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
export const YANGON_CENTER: [number, number] = [96.1735, 16.8409];
export const MAP_MARKER_COLORS = {
  driver: "#2563EB",
  destination: "#DC2626",
  dispatch: "#16834A",
  otherStop: "#E58A13",
} as const;

export function publicMapboxToken(
  value = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
) {
  const token = value?.trim();
  return token?.startsWith("pk.") ? token : null;
}

export async function reverseGeocodeMapbox(
  pin: LocationPin,
  signal?: AbortSignal,
): Promise<string | null> {
  const token = publicMapboxToken();
  if (!token) return null;

  const query = new URLSearchParams({
    longitude: String(pin.longitude),
    latitude: String(pin.latitude),
    language: "en",
    access_token: token,
  });
  const response = await fetch(
    `https://api.mapbox.com/search/geocode/v6/reverse?${query}`,
    { signal },
  );
  if (!response.ok) return null;

  const result = (await response.json()) as {
    features?: {
      properties?: {
        full_address?: unknown;
        name_preferred?: unknown;
        name?: unknown;
        place_formatted?: unknown;
      };
    }[];
  };
  const properties = result.features?.[0]?.properties;
  const fullAddress = properties?.full_address;
  if (typeof fullAddress === "string" && fullAddress.trim())
    return fullAddress.trim();

  const name = properties?.name_preferred ?? properties?.name;
  const formatted = properties?.place_formatted;
  const address = [name, formatted]
    .filter((part): part is string => typeof part === "string" && !!part.trim())
    .map((part) => part.trim())
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(", ");
  return address || null;
}

export function mapboxCoordinates(pin: LocationPin): [number, number] {
  const valid = locationSchema.parse(pin);
  return [valid.longitude, valid.latitude];
}

export function pinFromMapbox(point: {
  lat: number;
  lng: number;
}): LocationPin | null {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90
  )
    return null;
  // Mapbox can return world copies beyond +/-180 when the map is panned.
  const longitude =
    point.lng >= -180 && point.lng <= 180
      ? point.lng
      : ((((point.lng + 180) % 360) + 360) % 360) - 180;
  return {
    latitude: Number(point.lat.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}
