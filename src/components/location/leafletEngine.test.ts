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

  describe("the exact pin as a link (Phase 12S S3)", () => {
    const HREF = "https://www.google.com/maps/dir/?api=1&destination=33.7%2C73.05"

    it("with a destination the pin is a real, keyboard-reachable link to Google Maps in a new tab", () => {
      const element = host()
      const handle = leafletEngine.mount(element, { ...OPTIONS, marker: { position: OPTIONS.center, label: "Capital Bakers location", href: HREF } })
      const pin = element.querySelector(".b17-map-pin")
      expect(pin?.tagName).toBe("A")
      expect(pin).toHaveAttribute("href", HREF)
      expect(pin).toHaveAttribute("target", "_blank")
      expect(pin).toHaveAttribute("rel", "noopener noreferrer")
      expect(pin).toHaveAttribute("aria-label", "Open this location in Google Maps")
      expect(pin).toHaveAttribute("title", "Open this location in Google Maps")
      expect(pin?.getAttribute("tabindex")).not.toBe("-1") // a native link: in the tab order, opens with Enter
      handle.destroy()
    })

    it("without a destination it stays a plain labelled picture (nothing to activate)", () => {
      const element = host()
      const handle = leafletEngine.mount(element, { ...OPTIONS, marker: { position: OPTIONS.center, label: "Capital Bakers location" } })
      const pin = element.querySelector(".b17-map-pin")
      expect(pin?.tagName).toBe("SPAN")
      expect(pin).not.toHaveAttribute("href")
      expect(element.querySelector("a.b17-map-pin")).toBeNull()
      handle.destroy()
    })

    it("accepts only an https destination, and a destination cannot break out of the attribute", () => {
      const element = host()
      const bad = leafletEngine.mount(element, { ...OPTIONS, marker: { position: OPTIONS.center, label: "x", href: "javascript:alert(1)" } })
      expect(element.querySelector("a.b17-map-pin")).toBeNull()
      bad.destroy()

      const element2 = host()
      const tricky = leafletEngine.mount(element2, {
        ...OPTIONS,
        marker: { position: OPTIONS.center, label: "x", href: 'https://www.google.com/maps/dir/?a="><img src=x onerror=alert(1)>' },
      })
      expect(element2.querySelector("img[src='x']")).toBeNull()
      expect(element2.querySelectorAll("a.b17-map-pin")).toHaveLength(1)
      tricky.destroy()
    })

    it("an approximate area has no pin at all, so nothing there can open a destination", () => {
      const element = host()
      const handle = leafletEngine.mount(element, { ...OPTIONS, zoom: 14, circle: { center: OPTIONS.center, radiusMeters: 450 } })
      expect(element.querySelector("a.b17-map-pin")).toBeNull()
      expect(element.querySelector('a[href*="google.com"]')).toBeNull()
      handle.destroy()
    })
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
