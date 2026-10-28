/**
 * The localities a listing's `area` may name (Phase 12S, S4).
 *
 * The backend accepts only a canonical locality from its configured `LOCALITIES` (default `["B-17"]`;
 * `422 validation_error` / `unknown_locality` for anything else, LOCATION_MAP.md §4), and `block` is a
 * separate free-text field inside `location`. So the form offers a choice from this list instead of free
 * text: "Islamabad" or "B-17 Block C" can never be typed into `area` (a block belongs in Block).
 *
 * No endpoint publishes the list, and none is invented: this mirrors the backend default. A deployment
 * that adds a locality adds it in both places (`backend` `LOCALITIES`, here).
 */
export const LOCALITIES = ["B-17"] as const

export type Locality = (typeof LOCALITIES)[number]

export const DEFAULT_LOCALITY: Locality = LOCALITIES[0]

/** The configured spelling of `area` (trimmed, whitespace-collapsed, case-insensitive), or `null`. Same rule as the backend. */
export function canonicalLocality(area: string): Locality | null {
  const wanted = area.split(/\s+/).filter(Boolean).join(" ").toLowerCase()
  return LOCALITIES.find((locality) => locality.toLowerCase() === wanted) ?? null
}
