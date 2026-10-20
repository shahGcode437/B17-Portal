import {
  APPROXIMATE_CIRCLE_RADIUS_METERS,
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_URL,
  MAP_ZOOM_APPROXIMATE,
  MAP_ZOOM_EXACT,
} from "@/config/map"
import type { MapViewOptions } from "@/components/location/mapEngine"
import type { PublicLocation } from "@/types/location"

/**
 * What to draw for a PUBLIC location, or `null` when nothing should be drawn:
 *  - exact + an exact point -> a pin;
 *  - approximate + a rounded point -> an illustrative circle (no pin, no accuracy claim);
 *  - area-only, no point, or a point whose precision does not match the mode -> nothing.
 */
export function mapOptionsFor(location: PublicLocation, label: string): MapViewOptions | null {
  const point = location.coordinates
  if (!point) return null
  const center = { latitude: point.latitude, longitude: point.longitude }
  if (location.visibility === "exact" && point.precision === "exact") {
    return {
      center,
      zoom: MAP_ZOOM_EXACT,
      tileUrl: MAP_TILE_URL,
      attribution: MAP_TILE_ATTRIBUTION,
      marker: { position: center, label: `${label} location` },
    }
  }
  if (location.visibility === "approximate" && point.precision === "approximate") {
    return {
      center,
      zoom: MAP_ZOOM_APPROXIMATE,
      tileUrl: MAP_TILE_URL,
      attribution: MAP_TILE_ATTRIBUTION,
      circle: { center, radiusMeters: APPROXIMATE_CIRCLE_RADIUS_METERS },
    }
  }
  return null
}
