/**
 * The map-library boundary (docs/backend/LOCATION_MAP.md §11).
 *
 * Pages and components talk to a `MapEngine`; only `leafletEngine.ts` imports Leaflet. A different
 * tile library (or a fake engine in tests, which therefore never needs a canvas, a DOM layout or the
 * network) is a one-file swap. Everything here is a plain value: a point is a latitude / longitude
 * pair of a PUBLIC location — there is no field that could carry a private one.
 */
export interface MapPoint {
  latitude: number
  longitude: number
}

export interface MapViewOptions {
  /** Where the map is centred. */
  center: MapPoint
  zoom: number
  tileUrl: string
  /** Attribution HTML; always shown. */
  attribution: string
  /** An exact pin, with its accessible label. */
  marker?: { position: MapPoint; label: string }
  /** An illustrative circle (approximate locations): no accuracy is claimed by its size. */
  circle?: { center: MapPoint; radiusMeters: number }
}

export interface MapHandle {
  /** Removes the map and everything it attached to the page. Safe to call once. */
  destroy: () => void
}

export interface MapEngine {
  mount: (element: HTMLElement, options: MapViewOptions) => MapHandle
}
