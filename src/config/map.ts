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
