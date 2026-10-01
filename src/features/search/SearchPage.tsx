import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
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
import { ResultList } from "@/features/search/ResultList"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useSearchResults } from "@/hooks/useSearchResults"
import { useResultPreview } from "@/hooks/useResultPreview"
import { searchTypeFilters } from "@/config/search"
import { serviceCategories } from "@/data/serviceCategories"
import { site } from "@/data/site"
import type { SearchResultKind, SearchFilters, SortOption } from "@/types/search"

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
  const preview = useResultPreview()

  const initialQuery = searchParams.get("q") ?? ""
  const type = readType(searchParams.get("type"))
  const filters = useFilters(searchParams)
  const sort = readSort(searchParams)

  const [inputValue, setInputValue] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(inputValue, 250)

  // Keep only `q` in sync as the user types — everything else in the URL
  // (type/filters/sort) is left exactly as it is, so typing never clears an
  // active filter. Uses the functional updater so this never depends on (or
  // can go stale against) `searchParams` itself — one source of truth.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (debouncedQuery.trim()) next.set("q", debouncedQuery.trim())
        else next.delete("q")
        return next
      },
      { replace: true }
    )
  }, [debouncedQuery, setSearchParams])

  const { results, visibleResults, hasMore, loadMore, loading } = useSearchResults(
    debouncedQuery,
    type,
    filters,
    sort
  )

  function handleTypeChange(nextType: SearchResultKind | "all") {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (nextType === "all") next.delete("type")
        else next.set("type", nextType)
        // A filter/sort value from the previous type is never valid for a
        // different type (different value space, e.g. provider category
        // slugs vs. business category names) — drop them rather than risk a
        // stale, silently-mismatched filter.
        for (const key of FILTER_PARAM_KEYS) next.delete(key)
        next.delete("sort")
        return next
      },
      { replace: true }
    )
  }

  function handleFiltersChange(nextFilters: SearchFilters) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        writeFilters(next, nextFilters)
        return next
      },
      { replace: true }
    )
  }

  function handleSortChange(nextSort: SortOption) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (nextSort === "default") next.delete("sort")
        else next.set("sort", nextSort)
        return next
      },
      { replace: true }
    )
  }

  function clearFilters() {
    setInputValue("")
    setSearchParams({}, { replace: true })
  }

  const hasActiveFilters =
    Boolean(debouncedQuery.trim()) || type !== "all" || Object.keys(filters).length > 0 || sort !== "default"

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
          onChange={setInputValue}
          onSubmit={setInputValue}
          placeholder={site.searchPrompt}
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
          {loading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </Typography>

        <ResultList hits={visibleResults} loading={loading} onSelect={preview.open} onClearFilters={clearFilters} />

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
