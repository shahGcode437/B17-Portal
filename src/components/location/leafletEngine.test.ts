import { afterEach, describe, expect, it, vi } from "vitest"
import { leafletEngine } from "@/components/location/leafletEngine"

/**
 * A smoke test of the real Leaflet engine inside jsdom: it proves the boundary actually mounts a
 * map, a pin / circle, the attribution and zoom control, and tears down cleanly. jsdom loads no
 * images and `fetch` is stubbed to fail the test if anything tries the network, so this never
 * contacts a tile server.
 */
const OPTIONS = {
  center: { latitude: 33.7, longitude: 73.05 },
  zoom: 16,
  tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

function host(): HTMLElement {
  const element = document.createElement("div")
  element.style.width = "300px"
  element.style.height = "200px"
  document.body.append(element)
  return element
}

describe("leafletEngine (jsdom smoke)", () => {
  it("mounts a pin with its accessible label, the attribution and zoom controls - then removes everything", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed in this test")))
    vi.stubGlobal("fetch", fetchSpy)
    const element = host()
    const handle = leafletEngine.mount(element, { ...OPTIONS, marker: { position: OPTIONS.center, label: "Capital Bakers location" } })
    expect(element.classList.contains("leaflet-container")).toBe(true)
    expect(element.querySelector(".b17-map-pin")).toHaveAttribute("aria-label", "Capital Bakers location")
    expect(element.querySelector(".leaflet-control-attribution")?.textContent).toContain("OpenStreetMap")
    expect(element.querySelector(".leaflet-control-zoom")).not.toBeNull()
    expect(element.querySelector(".b17-map-circle")).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    handle.destroy()
    expect(element.querySelector(".leaflet-pane")).toBeNull()
    expect(element.querySelector(".b17-map-pin")).toBeNull()
    expect(element.querySelector(".leaflet-control-attribution")).toBeNull()
  })

  it("draws the illustrative circle and no pin for an approximate area", () => {
    const element = host()
    const handle = leafletEngine.mount(element, { ...OPTIONS, zoom: 14, circle: { center: OPTIONS.center, radiusMeters: 450 } })
    expect(element.querySelector(".b17-map-circle")).not.toBeNull()
    expect(element.querySelector(".b17-map-pin")).toBeNull()
    expect(element.querySelector(".leaflet-control-attribution")).not.toBeNull()
    handle.destroy()
  })

  it("escapes the pin label so a listing name cannot inject markup", () => {
    const element = host()
    const handle = leafletEngine.mount(element, {
      ...OPTIONS,
      marker: { position: OPTIONS.center, label: '"><img src=x onerror=alert(1)>' },
    })
    expect(element.querySelector("img[src='x']")).toBeNull()
    expect(element.querySelector(".b17-map-pin img")).toBeNull()
    expect(element.querySelector(".b17-map-pin")?.getAttribute("aria-label")).toBe('"><img src=x onerror=alert(1)>')
    handle.destroy()
  })
})
