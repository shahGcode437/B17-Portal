import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom"
import { X } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SearchBar } from "@/components/inputs/SearchBar"
import { FilterControls } from "@/components/inputs/FilterControls"
import { FilterSheet } from "@/components/overlay/FilterSheet"
import { ResultPreviewDialog } from "@/components/overlay/ResultPreviewDialog"
import { ResultList, type ResultEmptyContent } from "@/features/search/ResultList"
import { useSearchResults } from "@/hooks/useSearchResults"
import { useSearchSuggestions } from "@/hooks/useSearchSuggestions"
import { useResultPreview } from "@/hooks/useResultPreview"
import { searchTypeFilters } from "@/config/search"
import { serviceCategories } from "@/data/serviceCategories"
import { site } from "@/data/site"
import type { SearchResultKind, SearchFilters, SearchSuggestion, SortOption } from "@/types/search"

const VALID_TYPES = new Set(searchTypeFilters.map((f) => f.value))
const FILTER_PARAM_KEYS = [
  "area",
  "category",
  "subject",
  "grade",
  "bedrooms",
  "furnished",
  "listingType",
  "propertyType",
] as const

function readType(value: string | null): SearchResultKind | "all" {
  return value && VALID_TYPES.has(value as SearchResultKind | "all") ? (value as SearchResultKind | "all") : "all"
}

/** Builds the filters object from already-read raw param values — kept separate from param-reading so `useFilters` below can list each primitive individually as a dependency (an object built fresh every render can't be depended on directly without defeating memoization). */
function buildFilters(raw: {
  area: string | null
  category: string | null
  subject: string | null
  grade: string | null
  bedrooms: string | null
  furnished: string | null
  listingType: string | null
  propertyType: string | null
}): SearchFilters {
  const filters: SearchFilters = {}
  if (raw.area) filters.area = raw.area
  if (raw.category) filters.category = raw.category
  if (raw.subject) filters.subject = raw.subject
  if (raw.grade) filters.grade = raw.grade
  if (raw.bedrooms) filters.minBedrooms = Number(raw.bedrooms)
  if (raw.furnished) filters.furnished = raw.furnished as SearchFilters["furnished"]
  if (raw.listingType) filters.listingType = raw.listingType as SearchFilters["listingType"]
  if (raw.propertyType) filters.propertyType = raw.propertyType
  return filters
}

/** Memoizes the filters object against the raw param primitives, so it's referentially stable across renders where nothing actually changed — required for `useSearchResults`'s effect to depend on it correctly. */
function useFilters(params: URLSearchParams): SearchFilters {
  const area = params.get("area")
  const category = params.get("category")
  const subject = params.get("subject")
  const grade = params.get("grade")
  const bedrooms = params.get("bedrooms")
  const furnished = params.get("furnished")
  const listingType = params.get("listingType")
  const propertyType = params.get("propertyType")

  return useMemo(
    () => buildFilters({ area, category, subject, grade, bedrooms, furnished, listingType, propertyType }),
    [area, category, subject, grade, bedrooms, furnished, listingType, propertyType]
  )
}

function readSort(params: URLSearchParams): SortOption {
  return params.get("sort") === "newest" ? "newest" : "default"
}

/** Writes the Phase 9B filter params onto `params` in place — unset/empty values are removed, never serialized as empty strings. */
function writeFilters(params: URLSearchParams, filters: SearchFilters) {
  const entries: [string, string | undefined][] = [
    ["area", filters.area],
    ["category", filters.category],
    ["subject", filters.subject],
    ["grade", filters.grade],
    ["bedrooms", filters.minBedrooms ? String(filters.minBedrooms) : undefined],
    ["furnished", filters.furnished],
    ["listingType", filters.listingType],
    ["propertyType", filters.propertyType],
  ]
  for (const [key, value] of entries) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
}

/** Switching type drops filters/sort that belong to the previous type (different value spaces) but never touches `q`. */
function applyType(params: URLSearchParams, nextType: SearchResultKind | "all") {
  if (nextType === "all") params.delete("type")
  else params.set("type", nextType)
  for (const key of FILTER_PARAM_KEYS) params.delete(key)
  params.delete("sort")
}

function categoryChipLabel(type: SearchResultKind | "all", value: string): string {
  if (type === "provider") return serviceCategories.find((c) => c.slug === value)?.label ?? value
  return value
}

interface ActiveChip {
  key: string
  label: string
  onRemove: () => void
}

/** Interactive Search/Explore (UI/UX Spec §8) — the core discovery journey's second step. */
function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const preview = useResultPreview()

  // The URL is the committed search state: results, type, filters and sort
  // all read straight from it, and nothing here mirrors local state into it.
  const committedQuery = (searchParams.get("q") ?? "").trim()
  const type = readType(searchParams.get("type"))
  const filters = useFilters(searchParams)
  const sort = readSort(searchParams)

  // The input is a draft of the URL's `q`: `null` means "show the URL's
  // value"; otherwise it holds the raw text being edited. Every write this
  // page makes is a REPLACE, so a PUSH/POP into the mounted page (Explore
  // link, Back/Forward, any other link to /search) is by definition an
  // external change — it drops the draft so the input follows the new URL
  // instead of the stale text overwriting it.
  const [draft, setDraft] = useState<string | null>(null)
  const [seenLocationKey, setSeenLocationKey] = useState(location.key)
  if (location.key !== seenLocationKey) {
    setSeenLocationKey(location.key)
    if (navigationType !== "REPLACE") setDraft(null)
  }
  const inputValue = draft ?? (searchParams.get("q") ?? "")

  const suggestions = useSearchSuggestions(inputValue, type)
  const typeFilter = searchTypeFilters.find((f) => f.value === type)
  const { results, visibleResults, hasMore, loadMore, loading } = useSearchResults(
    committedQuery,
    type,
    filters,
    sort
  )

  // Typing is debounced into the URL; Enter / picking a suggestion commit at once.
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(commitTimer.current), [])
  useEffect(() => {
    // A pending typing commit must not fire after an external navigation has
    // replaced the URL (the draft it would write was just discarded).
    if (navigationType !== "REPLACE") clearTimeout(commitTimer.current)
  }, [location.key, navigationType])

  /**
   * The single URL writer. It starts from the live browser URL rather than
   * from `searchParams` captured at render time: React Router applies
   * navigations in a transition, so a captured copy can lag a write made
   * moments ago and would silently revert it.
   */
  function updateParams(mutate: (params: URLSearchParams) => void) {
    const current = new URLSearchParams(window.location.search)
    const next = new URLSearchParams(current)
    mutate(next)
    if (next.toString() !== current.toString()) setSearchParams(next, { replace: true })
  }

  function handleInputChange(value: string) {
    setDraft(value)
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => commitQuery(value), 250)
  }

  /**
   * Commits a query now, optionally moving to `nextType` in the same URL
   * write (a picked suggestion that belongs to another content type).
   */
  function commitQuery(value: string, nextType?: SearchResultKind | "all") {
    clearTimeout(commitTimer.current)
    const trimmed = value.trim()
    setDraft(value)
    updateParams((params) => {
      if (trimmed) params.set("q", trimmed)
      else params.delete("q")
      if (nextType !== undefined && nextType !== readType(params.get("type"))) applyType(params, nextType)
    })
  }

  function handleSuggestionSelect(suggestion: SearchSuggestion) {
    commitQuery(suggestion.value, suggestion.type)
  }

  function handleTypeChange(nextType: SearchResultKind | "all") {
    // A filter/sort value from the previous type is never valid for a
    // different type (different value space, e.g. provider category slugs vs.
    // business category names) — applyType drops them; `q` is preserved.
    updateParams((params) => applyType(params, nextType))
  }

  function handleFiltersChange(nextFilters: SearchFilters) {
    updateParams((params) => writeFilters(params, nextFilters))
  }

  function handleSortChange(nextSort: SortOption) {
    updateParams((params) => {
      if (nextSort === "default") params.delete("sort")
      else params.set("sort", nextSort)
    })
  }

  function clearFilters() {
    clearTimeout(commitTimer.current)
    setDraft("")
    updateParams((params) => {
      for (const key of Array.from(params.keys())) params.delete(key)
    })
  }

  const typeLabel = type === "all" ? null : (typeFilter?.label ?? null)

  // Zero results: say what was searched and where, and offer real next steps
  // (clear just the query keeping the type, or widen to everything).
  const emptyContent: ResultEmptyContent = committedQuery
    ? {
        title: typeLabel ? `No ${typeLabel} results for “${committedQuery}”` : `No results for “${committedQuery}”`,
        description: typeLabel
          ? `Nothing in ${typeLabel} matches this search. Clear it to browse everything in ${typeLabel}, or search all of B-17 instead.`
          : "Try a different search term, or clear filters to browse everything.",
        actionLabel: typeLabel ? `Clear search and browse ${typeLabel}` : "Clear search",
        onAction: () => commitQuery(""),
        ...(typeLabel && {
          secondaryActionLabel: "Search all of B-17",
          onSecondaryAction: () => handleTypeChange("all"),
        }),
      }
    : {
        title: "No results found",
        description: "Try a different search term, or clear filters to browse everything.",
        actionLabel: "Clear filters",
        onAction: clearFilters,
      }

  const hasActiveFilters =
    Boolean(committedQuery) || type !== "all" || Object.keys(filters).length > 0 || sort !== "default"

  const activeChips: ActiveChip[] = []
  if (type !== "all") {
    const label = searchTypeFilters.find((f) => f.value === type)?.label ?? type
    activeChips.push({ key: "type", label, onRemove: () => handleTypeChange("all") })
  }
  if (filters.area) {
    activeChips.push({
      key: "area",
      label: `Area: ${filters.area}`,
      onRemove: () => handleFiltersChange({ ...filters, area: undefined }),
    })
  }
  if (filters.category) {
    activeChips.push({
      key: "category",
      label: `Category: ${categoryChipLabel(type, filters.category)}`,
      onRemove: () => handleFiltersChange({ ...filters, category: undefined }),
    })
  }
  if (filters.subject) {
    activeChips.push({
      key: "subject",
      label: `Subject: ${filters.subject}`,
      onRemove: () => handleFiltersChange({ ...filters, subject: undefined }),
    })
  }
  if (filters.grade) {
    activeChips.push({
      key: "grade",
      label: `Grade: ${filters.grade}`,
      onRemove: () => handleFiltersChange({ ...filters, grade: undefined }),
    })
  }
  if (filters.listingType) {
    activeChips.push({
      key: "listingType",
      label: filters.listingType === "sale" ? "For Sale" : "For Rent",
      onRemove: () => handleFiltersChange({ ...filters, listingType: undefined }),
    })
  }
  if (filters.propertyType) {
    activeChips.push({
      key: "propertyType",
      label: filters.propertyType,
      onRemove: () => handleFiltersChange({ ...filters, propertyType: undefined }),
    })
  }
  if (filters.minBedrooms) {
    activeChips.push({
      key: "minBedrooms",
      label: `${filters.minBedrooms}+ Bedrooms`,
      onRemove: () => handleFiltersChange({ ...filters, minBedrooms: undefined }),
    })
  }
  if (filters.furnished) {
    activeChips.push({
      key: "furnished",
      label: filters.furnished,
      onRemove: () => handleFiltersChange({ ...filters, furnished: undefined }),
    })
  }
  if (sort !== "default") {
    activeChips.push({ key: "sort", label: "Sort: Newest", onRemove: () => handleSortChange("default") })
  }

  return (
    <Container className="py-8 sm:py-12">
      <Stack gap={6}>
        <Stack gap={2}>
          <Typography variant="h1">Search / Explore</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Search across services, businesses, tutors, properties and news.
          </Typography>
        </Stack>

        <SearchBar
          value={inputValue}
          onChange={handleInputChange}
          onSubmit={commitQuery}
          placeholder={typeFilter?.placeholder ?? site.searchPrompt}
          suggestions={suggestions}
          onSuggestionSelect={handleSuggestionSelect}
        />

        <Stack direction="row" align="center" justify="between" wrap gap={3}>
          <Card variant="default" className="hidden gap-3 p-3 md:flex md:w-full">
            <FilterControls
              type={type}
              onTypeChange={handleTypeChange}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              sort={sort}
              onSortChange={handleSortChange}
              onClear={clearFilters}
              showClear={hasActiveFilters}
            />
          </Card>
          <FilterSheet
            type={type}
            onTypeChange={handleTypeChange}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            sort={sort}
            onSortChange={handleSortChange}
            onClear={clearFilters}
            showClear={hasActiveFilters}
            resultCount={results.length}
          />
        </Stack>

        {activeChips.length > 0 && (
          <Stack direction="row" wrap gap={2}>
            {activeChips.map((chip) => (
              <Badge
                key={chip.key}
                variant="secondary"
                className="gap-1 border border-primary/30 bg-primary/5 py-1 pr-1 text-primary"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remove ${chip.label} filter`}
                  className="rounded-full p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
          </Stack>
        )}

        <Typography variant="label" className="text-foreground">
          {loading
            ? "Searching…"
            : `${results.length} result${results.length === 1 ? "" : "s"}${committedQuery ? ` for “${committedQuery}”` : ""}`}
        </Typography>

        <ResultList hits={visibleResults} loading={loading} onSelect={preview.open} empty={emptyContent} />

        {!loading && hasMore && (
          <Stack align="center">
            <Button variant="outline" onClick={loadMore}>
              Load More
            </Button>
          </Stack>
        )}
      </Stack>

      <ResultPreviewDialog result={preview.selected} onOpenChange={preview.onOpenChange} />
    </Container>
  )
}

export { SearchPage }
