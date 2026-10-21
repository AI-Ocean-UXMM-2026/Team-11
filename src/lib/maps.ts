import { locationSchema, type LocationPin } from "./contact";

export const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
export const YANGON_CENTER: [number, number] = [96.1735, 16.8409];

export function publicMapboxToken(
  value = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
) {
  const token = value?.trim();
  return token?.startsWith("pk.") ? token : null;
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
