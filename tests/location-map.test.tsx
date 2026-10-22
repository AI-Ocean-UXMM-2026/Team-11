// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationPicker } from "../src/components/location-picker";
import { LocationMap } from "../src/components/location-map";
import { LocationLink } from "../src/components/location-link";

const sdk = vi.hoisted(() => ({
  maps: [] as any[],
  markers: [] as any[],
  supported: vi.fn(() => true),
}));
vi.mock("mapbox-gl", () => {
  class Map {
    handlers: Record<string, (event?: any) => void> = {};
    canvas = document.createElement("canvas");
    remove = vi.fn(() => this.canvas.remove());
    resize = vi.fn();
    jumpTo = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    sources: Record<
      string,
      { data: unknown; setData: ReturnType<typeof vi.fn> }
    > = {};
    layers: any[] = [];
    isStyleLoaded() {
      return true;
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addSource(id: string, options: any) {
      this.sources[id] = {
        data: options.data,
        setData: vi.fn((data: unknown) => {
          this.sources[id].data = data;
        }),
      };
    }
    addLayer(layer: any) {
      this.layers.push(layer);
    }
    controls: { control: unknown; position: string }[] = [];
    constructor(public options: any) {
      options.container.append(this.canvas);
      sdk.maps.push(this);
    }
    on(event: string, callback: (event?: any) => void) {
      this.handlers[event] = callback;
      return this;
    }
    emit(event: string, value?: any) {
      this.handlers[event]?.(value);
    }
    addControl(control: unknown, position: string) {
      this.controls.push({ control, position });
      return this;
    }
    getCanvas() {
      return this.canvas;
    }
    getCenter() {
      return { lng: 96.17, lat: 16.84 };
    }
    getBounds() {
      return { contains: () => false };
    }
  }
  class Marker {
    handlers: Record<string, () => void> = {};
    element: HTMLElement;
    point: number[] = [];
    remove = vi.fn(() => this.element.remove());
    constructor(public options: any) {
      this.element = options.element ?? document.createElement("div");
      sdk.markers.push(this);
    }
    getElement() {
      return this.element;
    }
    on(event: string, callback: () => void) {
      this.handlers[event] = callback;
      return this;
    }
    setLngLat(point: number[]) {
      this.point = point;
      return this;
    }
    getLngLat() {
      return { lng: this.point[0], lat: this.point[1] };
    }
    addTo(map: Map) {
      map.options.container.append(this.element);
      return this;
    }
  }
  return {
    default: {
      Map,
      Marker,
      NavigationControl: class {},
      FullscreenControl: class {},
      supported: sdk.supported,
    },
  };
});

let root: Root;
let host: HTMLDivElement;
const disconnected = vi.fn();
beforeEach(() => {
  sdk.maps.length = 0;
  sdk.markers.length = 0;
  sdk.supported.mockReturnValue(true);
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test.public");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {
        disconnected();
      }
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const render = async (node: ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

it("saves map clicks and marker drags in the existing form contract, including zero coordinates", async () => {
  await render(
    <form>
      <LocationPicker required label="Branch location" />
    </form>,
  );
  expect(
    host.querySelector('input[name="latitude"]')?.getAttribute("value"),
  ).toBe("");
  await act(async () =>
    sdk.maps[0].emit("click", { lngLat: { lat: 16.84, lng: 96.17 } }),
  );
  expect(new FormData(host.querySelector("form")!).get("latitude")).toBe(
    "16.84",
  );
  expect(new FormData(host.querySelector("form")!).get("longitude")).toBe(
    "96.17",
  );
  expect(sdk.markers[0].point).toEqual([96.17, 16.84]);
  await act(async () => {
    sdk.markers[0].point = [0, 0];
    sdk.markers[0].handlers.dragend();
  });
  expect(new FormData(host.querySelector("form")!).get("latitude")).toBe("0");
  expect(host.textContent).toContain("Location selected");
  expect(host.querySelectorAll('input:not([type="hidden"])')).toHaveLength(0);
});

it("fills a linked address field from the selected map pin", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("longitude=96.17");
      expect(String(input)).toContain("latitude=16.84");
      return {
        ok: true,
        json: async () => ({
          features: [
            { properties: { full_address: "No. 10, Yangon, Myanmar" } },
          ],
        }),
      };
    }),
  );
  function AddressForm() {
    const [address, setAddress] = useState("");
    return (
      <form>
        <textarea
          name="address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <LocationPicker
          label="Delivery location"
          addressValue={address}
          onAddressChange={setAddress}
        />
      </form>
    );
  }

  await render(<AddressForm />);
  await act(async () =>
    sdk.maps[0].emit("click", { lngLat: { lat: 16.84, lng: 96.17 } }),
  );

  expect(
    (host.querySelector('textarea[name="address"]') as HTMLTextAreaElement)
      .value,
  ).toBe("No. 10, Yangon, Myanmar");
  expect(host.textContent).toContain(
    "Address updated from the pinned location.",
  );
});

it("keeps the map instance while changing a saved pin and cleans up when closed", async () => {
  await render(
    <LocationMap
      pin={{ latitude: 16.84, longitude: 96.17 }}
      label="Saved location"
    />,
  );
  expect(sdk.markers[0].options.draggable).toBe(false);
  expect(sdk.maps[0].options.cooperativeGestures).toBe(true);
  expect(sdk.maps[0].options.scrollZoom).not.toBe(false);
  expect(
    sdk.maps[0].controls.map(({ position }: { position: string }) => position),
  ).toEqual(["top-left", "top-right"]);
  expect(sdk.markers[0].point).toEqual([96.17, 16.84]);
  await render(
    <LocationMap
      pin={{ latitude: 16.85, longitude: 96.18 }}
      label="Saved location"
    />,
  );
  expect(sdk.maps).toHaveLength(1);
  expect(sdk.markers[0].point).toEqual([96.18, 16.85]);
  expect(sdk.maps[0].handlers.click).toBeUndefined();
  await render(null);
  expect(sdk.maps[0].remove).toHaveBeenCalled();
  expect(disconnected).toHaveBeenCalled();
});

it("explains missing configuration without making a map request or losing a stored pin", async () => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
  await render(
    <form>
      <LocationPicker
        initialPin={{ latitude: 0, longitude: 0 }}
        label="Account location"
      />
    </form>,
  );
  expect(host.textContent).toContain("Mapbox is not configured");
  expect(sdk.maps).toHaveLength(0);
  expect(new FormData(host.querySelector("form")!).get("longitude")).toBe("0");
});

it("frames driver and destination pins clear of map controls and keeps their labels and colors", async () => {
  await render(
    <LocationMap
      label="Delivery tracking"
      pin={{ latitude: 16.84, longitude: 96.13 }}
      pinLabel="Driver's last reported location"
      pinColor="#2868b2"
      markers={[
        {
          id: "destination",
          pin: { latitude: 16.83, longitude: 96.17 },
          label: "Delivery destination",
          color: "#17674f",
        },
      ]}
    />,
  );
  expect(
    sdk.markers[0].element.style.getPropertyValue("--location-marker-color"),
  ).toBe("#2868b2");
  expect(
    sdk.markers.some(
      (m: any) =>
        m.element.style.getPropertyValue("--location-marker-color") ===
          "#17674f" &&
        m.element.getAttribute("aria-label") === "Delivery destination",
    ),
  ).toBe(true);
  expect(sdk.maps[0].fitBounds).toHaveBeenCalledWith(
    [
      [96.13, 16.83],
      [96.17, 16.84],
    ],
    expect.objectContaining({
      padding: { top: 55, bottom: 50, left: 90, right: 80 },
    }),
  );
  expect(sdk.maps[0].jumpTo).not.toHaveBeenCalled();
});

it("opens a saved pin in a read-only dialog and closes it without following an external link", async () => {
  await render(
    <p>
      <LocationLink pin={{ latitude: 16.84, longitude: 96.17 }} />
    </p>,
  );
  await act(async () => host.querySelector("button")!.click());
  expect(document.querySelector("dialog")?.parentElement).toBe(document.body);
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(sdk.markers[0].options.draggable).toBe(false);
  await act(async () =>
    (
      document.querySelector(
        'button[aria-label="Close location map"]',
      ) as HTMLButtonElement
    ).click(),
  );
  expect(document.querySelector("dialog")).toBeNull();
  expect(sdk.maps[0].remove).toHaveBeenCalled();
});

it("reports provider errors and allows keyboard pin placement", async () => {
  await render(
    <form>
      <LocationPicker label="Delivery location" />
    </form>,
  );
  await act(async () => sdk.maps[0].emit("error"));
  expect(host.textContent).toContain("Mapbox could not load");
  await act(async () =>
    sdk.maps[0].canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(new FormData(host.querySelector("form")!).get("longitude")).toBe(
    "96.17",
  );
});

it("draws road geometry and remaining progress without replacing the map, with explicit follow and route overview controls", async () => {
  const route: [number, number][] = [
    [96.1, 16.8],
    [96.12, 16.8],
    [96.12, 16.82],
  ];
  const node = (remaining = route) => (
    <LocationMap
      label="Delivery tracking"
      pin={{ latitude: 16.8, longitude: 96.1 }}
      pinColor="#2868b2"
      navigation
      route={route}
      remainingRoute={remaining}
    />
  );
  await render(node());
  await act(async () => sdk.maps[0].emit("load"));
  expect(
    sdk.maps[0].sources["delivery-road-route"].data.features[0].geometry
      .coordinates,
  ).toEqual(route);
  expect(
    sdk.maps[0].layers.find((l: any) => l.id === "delivery-road-remaining")
      .paint["line-color"],
  ).toBe("#2868b2");
  await render(
    node([
      [96.11, 16.8],
      [96.12, 16.8],
      [96.12, 16.82],
    ]),
  );
  expect(sdk.maps).toHaveLength(1);
  expect(
    sdk.maps[0].sources["delivery-road-remaining"].data.features[0].geometry
      .coordinates[0],
  ).toEqual([96.11, 16.8]);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Recenter on me"))!
      .click(),
  );
  expect(sdk.maps[0].easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ center: [96.1, 16.8], zoom: 16 }),
  );
  await act(async () => sdk.maps[0].emit("dragstart"));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain(
    "Show full route",
  );
  await render(
    <LocationMap
      label="Delivery tracking"
      pin={{ latitude: 16.8, longitude: 96.1 }}
      pinColor="#2868b2"
    />,
  );
  expect(sdk.maps[0].sources["delivery-road-route"].data.features).toHaveLength(
    0,
  );
});
