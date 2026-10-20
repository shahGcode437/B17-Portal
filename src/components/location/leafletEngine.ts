import L from "leaflet"
// Loaded once, with this lazily-fetched module: the Leaflet code and its stylesheet are in a chunk
// of their own, so no other route pays for them (Phase 9H code splitting is preserved).
import "leaflet/dist/leaflet.css"
import type { MapEngine, MapHandle, MapViewOptions } from "@/components/location/mapEngine"

/**
 * The ONLY file that imports Leaflet (docs/backend/LOCATION_MAP.md §10.1). It uses Leaflet directly
 * rather than `react-leaflet`, whose licence (Hippocratic-2.1) the 12A review chose not to adopt.
 *
 * Choices, all deliberate:
 *  - the pin is a CSS `divIcon` (see `.b17-map-pin` in index.css), so Leaflet's default marker image
 *    URLs — which bundlers break — are never used and no marker asset ships;
 *  - no scroll-wheel zoom (a map must not hijack page scrolling) and no one-finger drag on touch
 *    devices (it would trap a vertical swipe on mobile); zoom buttons and two-finger gestures work;
 *  - the attribution control is on, and nothing removes or hides it;
 *  - tile requests carry the standard `Referer` policy OSM needs; no geolocation, no geocoding.
 */
function pinIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: "b17-map-pin-wrapper",
    html: `<span class="b17-map-pin" role="img" aria-label="${escapeAttribute(label)}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export const leafletEngine: MapEngine = {
  mount(element: HTMLElement, options: MapViewOptions): MapHandle {
    const map = L.map(element, {
      center: [options.center.latitude, options.center.longitude],
      zoom: options.zoom,
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer(options.tileUrl, {
      attribution: options.attribution,
      maxZoom: 19,
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(map)
    if (options.circle) {
      L.circle([options.circle.center.latitude, options.circle.center.longitude], {
        radius: options.circle.radiusMeters,
        className: "b17-map-circle",
        interactive: false,
      }).addTo(map)
    }
    if (options.marker) {
      L.marker([options.marker.position.latitude, options.marker.position.longitude], {
        icon: pinIcon(options.marker.label),
        keyboard: false,
        interactive: false,
      }).addTo(map)
    }
    return {
      destroy() {
        map.remove()
      },
    }
  },
}
