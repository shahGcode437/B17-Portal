import { Building2, GraduationCap, KeyRound, Newspaper, Wrench } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import type { SearchResultKind, SearchSuggestion } from "@/types/search"

const kindIcons: Record<SearchResultKind, LucideIcon> = {
  provider: Wrench,
  business: Building2,
  tutor: GraduationCap,
  property: KeyRound,
  news: Newspaper,
}

interface SearchSuggestionListProps {
  id: string
  suggestions: SearchSuggestion[]
  activeIndex: number
  getOptionId: (index: number) => string
  onSelect: (suggestion: SearchSuggestion) => void
}

/**
 * The listbox half of the SearchBar combobox. Options never take DOM focus —
 * the input keeps it and points at the active option via
 * `aria-activedescendant` — so mouse presses are kept from blurring the input.
 */
function SearchSuggestionList({ id, suggestions, activeIndex, getOptionId, onSelect }: SearchSuggestionListProps) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Search suggestions"
      onMouseDown={(e) => e.preventDefault()}
      className="absolute inset-x-0 top-full z-dropdown mt-2 max-h-[min(18rem,45svh)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-left text-popover-foreground shadow-elevated"
    >
      {suggestions.map((suggestion, index) => {
        const Icon = kindIcons[suggestion.type]
        return (
          <li
            key={suggestion.id}
            id={getOptionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onSelect(suggestion)}
            className="flex cursor-pointer items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 transition-colors hover:bg-muted aria-selected:border-primary aria-selected:bg-accent"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <Typography as="span" variant="body-sm" className="block truncate font-medium">
                {suggestion.label}
              </Typography>
              <Typography variant="caption" className="block truncate">
                {suggestion.secondaryLabel}
              </Typography>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export { SearchSuggestionList }
