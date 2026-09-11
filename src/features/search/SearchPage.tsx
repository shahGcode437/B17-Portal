import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { SearchBar } from "@/components/inputs/SearchBar"
import { FilterControls } from "@/components/inputs/FilterControls"
import { FilterSheet } from "@/components/overlay/FilterSheet"
import { ResultPreviewDialog } from "@/components/overlay/ResultPreviewDialog"
import { ResultList } from "@/features/search/ResultList"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useSearchResults } from "@/hooks/useSearchResults"
import { useResultPreview } from "@/hooks/useResultPreview"
import { searchTypeFilters } from "@/config/search"
import { site } from "@/data/site"
import type { SearchResultKind } from "@/types/search"

const VALID_TYPES = new Set(searchTypeFilters.map((f) => f.value))

function readType(value: string | null): SearchResultKind | "all" {
  return value && VALID_TYPES.has(value as SearchResultKind | "all") ? (value as SearchResultKind | "all") : "all"
}

/** Interactive Search/Explore (UI/UX Spec §8) — the core discovery journey's second step. */
function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const preview = useResultPreview()

  const initialQuery = searchParams.get("q") ?? ""
  const type = readType(searchParams.get("type"))

  const [inputValue, setInputValue] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(inputValue, 250)

  // Keep the URL in sync as the user types/filters (replace — not push — so
  // back navigation returns to where the user came from, not keystroke history).
  useEffect(() => {
    const next = new URLSearchParams()
    if (debouncedQuery.trim()) next.set("q", debouncedQuery.trim())
    if (type !== "all") next.set("type", type)
    setSearchParams(next, { replace: true })
  }, [debouncedQuery, type, setSearchParams])

  const { results, loading } = useSearchResults(debouncedQuery, type)

  function handleTypeChange(nextType: SearchResultKind | "all") {
    const next = new URLSearchParams(searchParams)
    if (nextType === "all") next.delete("type")
    else next.set("type", nextType)
    setSearchParams(next, { replace: true })
  }

  function clearFilters() {
    setInputValue("")
    setSearchParams({}, { replace: true })
  }

  const hasActiveFilters = Boolean(debouncedQuery.trim()) || type !== "all"

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
          <div className="hidden md:block">
            <FilterControls
              type={type}
              onTypeChange={handleTypeChange}
              onClear={clearFilters}
              showClear={hasActiveFilters}
            />
          </div>
          <FilterSheet
            type={type}
            onTypeChange={handleTypeChange}
            onClear={clearFilters}
            showClear={hasActiveFilters}
            resultCount={results.length}
          />
          <Typography variant="body-sm" className="text-muted-foreground">
            {loading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </Typography>
        </Stack>

        <ResultList hits={results} loading={loading} onSelect={preview.open} onClearFilters={clearFilters} />
      </Stack>

      <ResultPreviewDialog result={preview.selected} onOpenChange={preview.onOpenChange} />
    </Container>
  )
}

export { SearchPage }
