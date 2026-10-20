import { fetchListing } from "@/lib/api/reads/listings"
import { fetchSearch, type SearchParams } from "@/lib/api/reads/search"
import { toListingHit, toSearchHits } from "@/lib/api/adapters"
import { useRead, type ReadResult } from "@/hooks/useRead"
import { paramsKey } from "@/services/searchParams"
import type { SearchHit } from "@/types/search"

type ListingKind = "provider" | "business" | "tutor" | "property"
type ItemOf<K extends ListingKind> = Extract<SearchHit, { kind: K }>["item"]

/**
 * A short, bounded page of one kind from `GET /search` (Home previews, landing pages). The API has
 * no "featured" filter, so a caller that wants featured-first sorts what it received itself; this
 * hook never invents a ranking.
 */
function useKindPage<K extends ListingKind>(
  kind: K,
  limit: number,
  extra: Omit<SearchParams, "type" | "limit" | "offset"> = {}
): ReadResult<{ items: ItemOf<K>[]; total: number }> {
  const params: SearchParams = { ...extra, type: kind, limit }
  return useRead(`kind:${paramsKey(params)}`, async (signal) => {
    const page = await fetchSearch(params, signal)
    const items = toSearchHits(page.items).flatMap((hit) => (hit.kind === kind ? [hit.item as ItemOf<K>] : []))
    return { items, total: page.meta.total }
  })
}

export const useProviders = (limit: number) => useKindPage<"provider">("provider", limit)
export const useTutors = (limit: number) => useKindPage<"tutor">("tutor", limit)
export const useProperties = (limit: number) => useKindPage<"property">("property", limit)
export const useBusinesses = (limit: number, vertical?: "general" | "food") =>
  useKindPage<"business">("business", limit, { vertical })

/** Featured items first, then the rest, keeping the server's order inside each group. */
export function featuredFirst<T extends { featured?: boolean }>(items: readonly T[]): T[] {
  return [...items.filter((item) => item.featured), ...items.filter((item) => !item.featured)]
}

/**
 * One public listing from `GET /listings/{id}`. `kind` is the page asking: a listing of another kind
 * (e.g. a business id opened on a provider page) is "not found" there, exactly like an unknown id —
 * each kind has one canonical route.
 */
export type ListingDetail<K extends ListingKind> =
  | { found: true; item: ItemOf<K> }
  | { found: false }

export function useListing<K extends ListingKind>(kind: K, id: string | undefined): ReadResult<ListingDetail<K>> {
  return useRead(
    `listing:${kind}:${id ?? ""}`,
    async (signal) => {
      const dto = await fetchListing(id ?? "", signal)
      const hit = toListingHit(dto)
      return hit.kind === kind ? { found: true as const, item: hit.item as ItemOf<K> } : { found: false as const }
    },
    { enabled: Boolean(id) }
  )
}
