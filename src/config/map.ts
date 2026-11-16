/**
 * Map configuration (docs/backend/LOCATION_MAP.md §10.2) — configuration, not code.
 *
 *  - `VITE_MAP_TILE_URL`: a `{z}/{x}/{y}` raster tile template. Development / demo default is the
 *    standard OpenStreetMap server, which is a community resource used lightly under the OSM Tile
 *    Usage Policy; a production tile provider is chosen at deployment time and only changes this.
 *  - `VITE_MAP_TILE_ATTRIBUTION`: the attribution HTML for that provider. It is ALWAYS rendered and
 *    never hidden or removed.
 *
 * The service worker ignores cross-origin requests, so tiles are never cached by the app (which the
 * OSM policy requires).
 */
const env = import.meta.env as Record<string, string | undefined>

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

export const MAP_TILE_URL: string = env.VITE_MAP_TILE_URL?.trim() || OSM_TILE_URL
export const MAP_TILE_ATTRIBUTION: string = env.VITE_MAP_TILE_ATTRIBUTION?.trim() || OSM_ATTRIBUTION

/** Initial zoom for an exact pin (street level) and for the approximate area (neighbourhood level). */
export const MAP_ZOOM_EXACT = 16
export const MAP_ZOOM_APPROXIMATE = 14

/**
 * Radius of the circle drawn for an APPROXIMATE location. It is purely illustrative: it is not an
 * accuracy claim and is never derived from the hidden exact point (which the client does not have).
 */
export const APPROXIMATE_CIRCLE_RADIUS_METERS = 450

/**
 * Approximate starting centre for the Multi Gardens B-17 sector, used ONLY as the initial pan when
 * the picker has no point yet. Rough average of three publicly-referenced points inside the sector
 * (B-17 sector reference 33.680967, 72.819052; Multi Gardens B-17 map point 33.686377, 72.831271;
 * Block B example 33.687759, 72.829501), rounded to three decimals so it reads as a neutral map
 * origin, not a surveyed centroid and not the address of any real shop, block or household.
 *
 * This is NOT an authoritative B-17 boundary and NOT a geofence; `LOCATION_MAP.md` §5 keeps that out
 * of V1 until authoritative geographic data is available. Everything downstream still accepts any
 * WGS-84 coordinate the owner picks; this value only controls where the empty map opens so a click
 * in the displayed sector produces coordinates in the real B-17 longitude range (~72.8x), not the
 * previous ~73.05 that opened around Islamabad / E-11.
 *
 * Can be overridden at deployment time via `VITE_MAP_DEFAULT_CENTER` (`<lat>,<lng>`); the override
 * is ignored when malformed so a typo does not silently change what owners see.
 */
export const B17_DEFAULT_CENTER: { latitude: number; longitude: number } =
  parseCenter(env.VITE_MAP_DEFAULT_CENTER) ?? { latitude: 33.685, longitude: 72.826 }

function parseCenter(raw: string | undefined): { latitude: number; longitude: number } | null {
  if (!raw) return null
  const parts = raw.split(",").map((part) => part.trim())
  if (parts.length !== 2) return null
  const latitude = Number(parts[0])
  const longitude = Number(parts[1])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}
