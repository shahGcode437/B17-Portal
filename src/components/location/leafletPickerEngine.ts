import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { MapHandle, MapViewOptions } from "@/components/location/mapEngine"

/**
 * Writable Leaflet engine for the location picker (Phase 12H). Separate from the read-only
 * `leafletEngine` because this one listens to clicks and reports them back through an `onPick`
 * callback. The read-only pin is never interactive; this one may be dragged. Lazy-loaded by
 * `MapPicker`, so Leaflet still ships in only one chunk.
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

export interface PickerOptions extends MapViewOptions {
  draggable?: boolean
  onPick?: (point: { latitude: number; longitude: number }) => void
}

export interface PickerEngine {
  mount: (element: HTMLElement, options: PickerOptions) => MapHandle
}

export const leafletPickerEngine: PickerEngine = {
  mount(element: HTMLElement, options: PickerOptions): MapHandle {
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
    let marker: L.Marker | undefined
    if (options.marker) {
      marker = L.marker([options.marker.position.latitude, options.marker.position.longitude], {
        icon: pinIcon(options.marker.label),
        keyboard: false,
        draggable: options.draggable ?? false,
        interactive: true,
      }).addTo(map)
      if (options.draggable && options.onPick) {
        marker.on("dragend", (event: L.LeafletEvent) => {
          const { lat, lng } = (event.target as L.Marker).getLatLng()
          options.onPick!({ latitude: lat, longitude: lng })
        })
      }
    }
    if (options.onPick) {
      map.on("click", (event: L.LeafletMouseEvent) => {
        options.onPick!({ latitude: event.latlng.lat, longitude: event.latlng.lng })
      })
    }
    return {
      destroy() {
        map.remove()
      },
    }
  },
}
