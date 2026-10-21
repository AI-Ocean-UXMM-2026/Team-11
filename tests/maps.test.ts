import { expect, it } from "vitest";
import {
  mapboxCoordinates,
  pinFromMapbox,
  publicMapboxToken,
} from "../src/lib/maps";

it("keeps stored latitude/longitude compatible with Mapbox longitude-first coordinates", () => {
  expect(mapboxCoordinates({ latitude: 16.84, longitude: 96.17 })).toEqual([
    96.17, 16.84,
  ]);
  expect(pinFromMapbox({ lat: 16.8409123, lng: 96.1735123 })).toEqual({
    latitude: 16.840912,
    longitude: 96.173512,
  });
  expect(pinFromMapbox({ lat: 0, lng: 456.17 })).toEqual({
    latitude: 0,
    longitude: 96.17,
  });
  expect(pinFromMapbox({ lat: 0, lng: -456.17 })).toEqual({
    latitude: 0,
    longitude: -96.17,
  });
  expect(pinFromMapbox({ lat: 91, lng: 0 })).toBeNull();
  expect(pinFromMapbox({ lat: 0, lng: Infinity })).toBeNull();
});

it("accepts only public Mapbox tokens for the client map", () => {
  expect(publicMapboxToken("  pk.test.public  ")).toBe("pk.test.public");
  expect(publicMapboxToken("")).toBeNull();
  expect(publicMapboxToken("sk.test.secret")).toBeNull();
});
