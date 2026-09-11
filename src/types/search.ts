import type { LucideIcon } from "lucide-react"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Tutor } from "@/types/tutor"
import type { Property } from "@/types/property"
import type { NewsArticle } from "@/types/news"

export type SearchResultKind = "provider" | "business" | "tutor" | "property" | "news"

/**
 * A search hit paired with its original, fully-typed domain record — lets
 * the result grid render the real per-kind card component (ProviderCard,
 * PropertyCard, ...) instead of a duplicate generic card.
 */
export type SearchHit =
  | { kind: "provider"; item: Provider }
  | { kind: "business"; item: Business }
  | { kind: "tutor"; item: Tutor }
  | { kind: "property"; item: Property }
  | { kind: "news"; item: NewsArticle }

/** Normalized shape for the single-item Preview Dialog (UI/UX Spec §8). */
export interface SearchResult {
  kind: SearchResultKind
  id: string
  title: string
  subtitle: string
  description: string
  area?: string
  image?: string
  icon: LucideIcon
  tags: string[]
}

export interface SearchTypeFilter {
  value: SearchResultKind | "all"
  label: string
}
