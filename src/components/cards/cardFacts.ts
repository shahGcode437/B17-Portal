import type { LucideIcon } from "lucide-react"

/** One real, short fact about a listing (a tag, a bedroom count, an opening-hours note...). */
export interface CardFact {
  text: string
  icon?: LucideIcon
}

const MAX_TAG_CHIPS = 3

/** A listing's real tags as facts, capped, with the remainder counted rather than silently hidden. */
export function tagFacts(tags: string[]): CardFact[] {
  const shown = tags.slice(0, MAX_TAG_CHIPS).map((text) => ({ text }))
  const rest = tags.length - shown.length
  return rest > 0 ? [...shown, { text: `+${rest} more` }] : shown
}
