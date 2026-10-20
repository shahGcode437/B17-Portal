/**
 * The PUBLIC view of where a listing is (docs/backend/LOCATION_MAP.md §7, §8, §11).
 *
 * Every public page, card and map receives this type and nothing richer: it has no field that could
 * carry a private (stored) point, an address of a non-exact listing, or an owner's raw input. The
 * adapter that builds it (`lib/api/adapters.ts`) additionally re-checks the privacy invariants, so a
 * misbehaving server response still cannot make an approximate or area-only listing look exact.
 */
export type LocationVisibility = "exact" | "approximate" | "area_only"

export interface PublicCoordinates {
  latitude: number
  longitude: number
  precision: "exact" | "approximate"
}

export interface PublicLocation {
  visibility: LocationVisibility
  /** The block letter / label as the owner typed it (public at every visibility). */
  block?: string
  /** Exact listings on the detail page only. */
  address?: string
  /** Exact listings on the detail page only. */
  landmark?: string
  /** Absent for area-only listings (and legacy rows). For `approximate` this is the ROUNDED point. */
  coordinates?: PublicCoordinates
}
