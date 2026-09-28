import type { SearchResultKind } from "@/types/search"

/** Kinds a resident can save. News is excluded — there's no product reason to bookmark an article today. */
export type SavedItemKind = Exclude<SearchResultKind, "news">

/**
 * A resident's saved/favorite reference (Phase 9C). Deliberately just a
 * pointer (`kind` + `id`), never a deep copy of the domain object — the live
 * item is always resolved through `search.ts` at render time, so this stays
 * correct if the underlying seed/listing data ever changes.
 */
export interface SavedItem {
  kind: SavedItemKind
  id: string
  savedAt: string
}

/**
 * Every status the UI can display. Only "submitted" is ever produced by this
 * phase's flow — the rest exist so provider-side transitions (Phase 9D) can
 * be introduced later without another status-model migration. No automated
 * transitions happen in Phase 9C.
 */
export type RequestStatus = "submitted" | "accepted" | "in-progress" | "completed" | "cancelled"

/**
 * A resident's own record of a submitted service request (Phase 9C). Fields
 * are limited to what `ServiceRequestForm`/`RequestServiceDialog` actually
 * collect today — nothing here is invented. `providerId` is the stable
 * reference for re-resolving the live provider; `providerName` is a display
 * snapshot so history still reads correctly if that provider is ever removed.
 */
export interface ServiceRequestRecord {
  id: string
  providerId: string
  providerName: string
  service: string
  details: string
  area: string
  preferredDate: string
  preferredTime?: string
  notes?: string
  requestedBy: string
  submittedAt: string
  status: RequestStatus
}
