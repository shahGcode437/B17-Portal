import type { PublicLocation } from "@/types/location"

/** Up to six decimal places (about 10 cm), trailing zeros trimmed — never exponent notation. */
function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(6)))
}

/**
 * Google's documented cross-platform directions URL (docs/backend/LOCATION_MAP.md §12): it needs no
 * API key, no SDK and no Google Cloud project. Built from NUMBERS only, so no string from the page
 * or the server is ever concatenated into the URL.
 */
export function buildDirectionsUrl(point: { latitude: number; longitude: number }): string {
  const destination = `${formatCoordinate(point.latitude)},${formatCoordinate(point.longitude)}`
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination }).toString()}`
}

/**
 * The directions URL for a public location, or `null`. Only an EXACT listing whose point is labelled
 * exact gets one; approximate and area-only listings never do (an approximate point is not an
 * address to navigate to, and no destination is ever invented).
 */
export function directionsUrlFor(location: PublicLocation | undefined): string | null {
  const point = location?.coordinates
  if (!location || !point || location.visibility !== "exact" || point.precision !== "exact") return null
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null
  return buildDirectionsUrl(point)
}
