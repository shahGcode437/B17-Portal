import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MapView } from "@/components/location/MapView"
import { mapOptionsFor } from "@/components/location/mapOptions"
import { LocationSection } from "@/components/location/LocationSection"
import { DirectionsButton } from "@/components/location/DirectionsButton"
import { buildDirectionsUrl, directionsUrlFor } from "@/components/location/directions"
import type { MapEngine, MapViewOptions } from "@/components/location/mapEngine"
import { APPROXIMATE_CIRCLE_RADIUS_METERS, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/config/map"
import type { PublicLocation } from "@/types/location"

const exact: PublicLocation = {
  visibility: "exact",
  block: "C",
  address: "Shop 4, Demo Plaza",
  landmark: "Next to the demo park",
  coordinates: { latitude: 33.701234, longitude: 73.051234, precision: "exact" },
}
const approximate: PublicLocation = {
  visibility: "approximate",
  block: "C",
  coordinates: { latitude: 33.71, longitude: 73.06, precision: "approximate" },
}
const areaOnly: PublicLocation = { visibility: "area_only", block: "D" }

/** A fake engine: records what it was asked to draw. No Leaflet, no canvas, no network. */
function fakeEngine() {
  const mounts: MapViewOptions[] = []
  const destroy = vi.fn()
  const engine: MapEngine = {
    mount: (_element, options) => {
      mounts.push(options)
      return { destroy }
    },
  }
  return { engine, mounts, destroy }
}

describe("directions", () => {
  it("builds Google's documented URL from numbers only, comma encoded, no API key", () => {
    const url = buildDirectionsUrl({ latitude: 33.701234, longitude: 73.051234 })
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=33.701234%2C73.051234")
    expect(url).not.toMatch(/key=/i)
  })

  it("trims to six decimals and never uses exponent notation", () => {
    expect(buildDirectionsUrl({ latitude: 33.7000001234, longitude: 73.0000004 })).toContain("destination=33.7%2C73")
    expect(buildDirectionsUrl({ latitude: 1e-7, longitude: 2 })).toContain("destination=0%2C2")
  })

  it("exists only for an exact listing with an exact point", () => {
    expect(directionsUrlFor(exact)).toContain("destination=33.701234%2C73.051234")
    expect(directionsUrlFor(approximate)).toBeNull()
    expect(directionsUrlFor(areaOnly)).toBeNull()
    expect(directionsUrlFor(undefined)).toBeNull()
    expect(directionsUrlFor({ ...exact, coordinates: undefined })).toBeNull()
    expect(directionsUrlFor({ ...exact, coordinates: { latitude: 33.7, longitude: 73.05, precision: "approximate" } })).toBeNull()
    expect(directionsUrlFor({ ...exact, coordinates: { latitude: Number.NaN, longitude: 73.05, precision: "exact" } })).toBeNull()
  })

  it("renders an accessible external link with noopener noreferrer, or nothing", () => {
    const { rerender, container } = render(<DirectionsButton location={exact} name="Capital Bakers" />)
    const link = screen.getByRole("link", { name: /get directions/i })
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveAccessibleName(/capital bakers/i)
    rerender(<DirectionsButton location={approximate} name="Capital Bakers" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("mapOptionsFor", () => {
  it("draws a labelled pin for an exact point", () => {
    const options = mapOptionsFor(exact, "Capital Bakers")
    expect(options?.marker).toEqual({ position: { latitude: 33.701234, longitude: 73.051234 }, label: "Capital Bakers location" })
    expect(options?.circle).toBeUndefined()
    expect(options).toMatchObject({ tileUrl: MAP_TILE_URL, attribution: MAP_TILE_ATTRIBUTION })
  })

  it("draws only an illustrative circle (no pin) for an approximate point", () => {
    const options = mapOptionsFor(approximate, "Mocha Corner Cafe")
    expect(options?.marker).toBeUndefined()
    expect(options?.circle).toEqual({ center: { latitude: 33.71, longitude: 73.06 }, radiusMeters: APPROXIMATE_CIRCLE_RADIUS_METERS })
  })

  it("draws nothing for area-only, a missing point, or a point that disagrees with its mode", () => {
    expect(mapOptionsFor(areaOnly, "x")).toBeNull()
    expect(mapOptionsFor({ visibility: "exact" }, "x")).toBeNull()
    expect(mapOptionsFor({ visibility: "exact", coordinates: { latitude: 1, longitude: 1, precision: "approximate" } }, "x")).toBeNull()
    expect(mapOptionsFor({ visibility: "approximate", coordinates: { latitude: 1, longitude: 1, precision: "exact" } }, "x")).toBeNull()
  })
})

describe("MapView", () => {
  it("mounts the engine once with the exact pin and reports ready", async () => {
    const { engine, mounts } = fakeEngine()
    render(<MapView location={exact} label="Capital Bakers" engine={engine} />)
    const map = screen.getByTestId("location-map")
    await waitFor(() => expect(map).toHaveAttribute("data-map-status", "ready"))
    expect(map).toHaveAttribute("data-map-mode", "exact")
    expect(map).toHaveAccessibleName("Map of Capital Bakers")
    expect(mounts).toHaveLength(1)
    expect(mounts[0].marker?.label).toBe("Capital Bakers location")
  })

  it("labels an approximate map as approximate", async () => {
    const { engine } = fakeEngine()
    render(<MapView location={approximate} label="Mocha Corner Cafe" engine={engine} />)
    expect(await screen.findByRole("group", { name: "Map of the approximate location of Mocha Corner Cafe" })).toBeInTheDocument()
  })

  it("renders no map element and never touches the engine for area-only or an unusable point", () => {
    const { engine, mounts } = fakeEngine()
    const { container, rerender } = render(<MapView location={areaOnly} label="x" engine={engine} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<MapView location={{ visibility: "exact", coordinates: { latitude: 999, longitude: 1, precision: "exact" } }} label="x" engine={engine} />)
    expect(mounts).toHaveLength(0)
  })

  it("destroys the map on unmount, and does not remount for an equal location object", async () => {
    const { engine, mounts, destroy } = fakeEngine()
    const { rerender, unmount } = render(<MapView location={exact} label="A" engine={engine} />)
    await waitFor(() => expect(mounts).toHaveLength(1))
    rerender(<MapView location={{ ...exact, coordinates: { ...exact.coordinates! } }} label="A" engine={engine} />)
    expect(mounts).toHaveLength(1)
    expect(destroy).not.toHaveBeenCalled()
    unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it("falls back to an honest message when the engine throws, leaving the page text intact", async () => {
    const engine: MapEngine = {
      mount: () => {
        throw new Error("no webgl")
      },
    }
    render(<MapView location={exact} label="A" engine={engine} />)
    expect(await screen.findByRole("status")).toHaveTextContent("The map could not be loaded")
    expect(screen.getByTestId("location-map")).toHaveAttribute("data-map-status", "failed")
  })

  it("shows the failure state when the engine chunk cannot be loaded", async () => {
    render(<MapView location={exact} label="A" engine={Promise.reject(new Error("chunk")) as unknown as MapEngine} />)
    await waitFor(() => expect(screen.getByTestId("location-map")).toHaveAttribute("data-map-status", "failed"))
  })
})

describe("LocationSection", () => {
  it("exact: address, landmark, area and block as text, a map and Get Directions", async () => {
    const { engine, mounts } = fakeEngine()
    render(<LocationSection name="Capital Bakers" area="B-17" location={exact} engine={engine} />)
    expect(screen.getByRole("heading", { name: "Location" })).toBeInTheDocument()
    expect(screen.getByText("Shop 4, Demo Plaza")).toBeInTheDocument()
    expect(screen.getByText("Next to the demo park")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /get directions/i })).toBeInTheDocument()
    await waitFor(() => expect(mounts).toHaveLength(1))
  })

  it("approximate: labelled approximate, block only, a circle - and no address, pin or directions", async () => {
    const { engine, mounts } = fakeEngine()
    render(<LocationSection name="Mocha Corner Cafe" area="B-17" location={approximate} engine={engine} />)
    expect(screen.getByRole("heading", { name: "Approximate location" })).toBeInTheDocument()
    expect(screen.getByText(/illustrative, not an exact address/i)).toBeInTheDocument()
    expect(screen.queryByText("Address")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
    await waitFor(() => expect(mounts).toHaveLength(1))
    expect(mounts[0].marker).toBeUndefined()
    expect(mounts[0].circle).toBeDefined()
  })

  it("approximate: no numeric accuracy or privacy radius is ever stated to the user (the circle is only illustrative)", async () => {
    const { engine, mounts, container } = (() => {
      const f = fakeEngine()
      const view = render(<LocationSection name="Mocha Corner Cafe" area="B-17" location={approximate} engine={f.engine} />)
      return { ...f, container: view.container }
    })()
    await waitFor(() => expect(mounts).toHaveLength(1))
    void engine
    const text = container.textContent ?? ""
    expect(text).toMatch(/Approximate location/)
    expect(text).not.toMatch(/450|within\s+\d|\d+\s*(m|meters?|metres?|km)|radius|accuracy|precision/i)
    expect(container.innerHTML).not.toMatch(/450/)
  })

  it("area-only: text only - no map, no engine, no directions", () => {
    const { engine, mounts } = fakeEngine()
    render(<LocationSection name="Pharmacy" area="B-17, Block C (Demo Area)" location={areaOnly} engine={engine} />)
    expect(screen.getByText("Location shared at area level.")).toBeInTheDocument()
    expect(screen.getByText("B-17, Block C (Demo Area)")).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
    expect(mounts).toHaveLength(0)
  })

  it("a legacy / missing location behaves exactly like area-only", () => {
    const { engine, mounts } = fakeEngine()
    render(<LocationSection name="Old" area="B-17" location={undefined} engine={engine} />)
    expect(screen.getByText("Location shared at area level.")).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
    expect(mounts).toHaveLength(0)
  })
})
