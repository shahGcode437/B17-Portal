import { X } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { cn } from "@/lib/utils"
import { searchTypeFilters } from "@/config/search"
import { serviceCategories } from "@/data/serviceCategories"
import {
  getProviderAreas,
  getBusinessCategories,
  getBusinessAreas,
  getTutorSubjects,
  getTutorGrades,
  getTutorAreas,
  getPropertyListingTypes,
  getPropertyTypes,
  getPropertyAreas,
  getPropertyBedroomOptions,
  getNewsCategories,
  FURNISHED_OPTIONS,
} from "@/services/search"
import type { SearchResultKind, SearchFilters, SortOption } from "@/types/search"

interface FilterControlsProps {
  type: SearchResultKind | "all"
  onTypeChange: (type: SearchResultKind | "all") => void
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  onClear: () => void
  showClear: boolean
  /** "inline" (desktop, compact row) vs "sheet" (mobile bottom sheet, full-width stacked fields). */
  layout?: "inline" | "sheet"
}

const selectClassName = cn(
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "md:text-sm dark:bg-input/30"
)

interface FilterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  full?: boolean
  /** Text for the empty/unset option. Defaults to "Any {label}", which reads correctly for filters but not for Sort. */
  placeholder?: string
}

/** One labeled `<select>` filter field — every option list here comes from real data via `search.ts`, never invented. */
function FilterSelect({ label, value, onChange, options, full, placeholder }: FilterSelectProps) {
  return (
    <select
      aria-label={label}
      className={cn(selectClassName, full ? "w-full" : "w-auto")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder ?? `Any ${label}`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function toOptions(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }))
}

/** Contextual filter fields for the currently-selected result type — nothing renders for "all" or a type with no honest filters to offer. */
function ContextualFilters({
  type,
  filters,
  onFiltersChange,
  full,
}: {
  type: SearchResultKind | "all"
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  full?: boolean
}) {
  function set(patch: Partial<SearchFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  if (type === "provider") {
    return (
      <>
        <FilterSelect
          label="Category"
          value={filters.category ?? ""}
          onChange={(v) => set({ category: v || undefined })}
          options={serviceCategories.map((c) => ({ value: c.slug, label: c.label }))}
          full={full}
        />
        <FilterSelect
          label="Area"
          value={filters.area ?? ""}
          onChange={(v) => set({ area: v || undefined })}
          options={toOptions(getProviderAreas())}
          full={full}
        />
      </>
    )
  }

  if (type === "business") {
    return (
      <>
        <FilterSelect
          label="Category"
          value={filters.category ?? ""}
          onChange={(v) => set({ category: v || undefined })}
          options={toOptions(getBusinessCategories())}
          full={full}
        />
        <FilterSelect
          label="Area"
          value={filters.area ?? ""}
          onChange={(v) => set({ area: v || undefined })}
          options={toOptions(getBusinessAreas())}
          full={full}
        />
      </>
    )
  }

  if (type === "tutor") {
    return (
      <>
        <FilterSelect
          label="Subject"
          value={filters.subject ?? ""}
          onChange={(v) => set({ subject: v || undefined })}
          options={toOptions(getTutorSubjects().map((s) => s.subject))}
          full={full}
        />
        <FilterSelect
          label="Grade"
          value={filters.grade ?? ""}
          onChange={(v) => set({ grade: v || undefined })}
          options={toOptions(getTutorGrades())}
          full={full}
        />
        <FilterSelect
          label="Area"
          value={filters.area ?? ""}
          onChange={(v) => set({ area: v || undefined })}
          options={toOptions(getTutorAreas())}
          full={full}
        />
      </>
    )
  }

  if (type === "property") {
    return (
      <>
        <FilterSelect
          label="Listing Type"
          value={filters.listingType ?? ""}
          onChange={(v) => set({ listingType: (v || undefined) as SearchFilters["listingType"] })}
          options={getPropertyListingTypes().map((t) => ({ value: t, label: t === "sale" ? "Sale" : "Rent" }))}
          full={full}
        />
        <FilterSelect
          label="Property Type"
          value={filters.propertyType ?? ""}
          onChange={(v) => set({ propertyType: v || undefined })}
          options={toOptions(getPropertyTypes())}
          full={full}
        />
        <FilterSelect
          label="Bedrooms"
          value={filters.minBedrooms ? String(filters.minBedrooms) : ""}
          onChange={(v) => set({ minBedrooms: v ? Number(v) : undefined })}
          options={getPropertyBedroomOptions().map((n) => ({ value: String(n), label: `${n}+` }))}
          full={full}
        />
        <FilterSelect
          label="Furnishing"
          value={filters.furnished ?? ""}
          onChange={(v) => set({ furnished: (v || undefined) as SearchFilters["furnished"] })}
          options={FURNISHED_OPTIONS.map((f) => ({ value: f, label: f }))}
          full={full}
        />
        <FilterSelect
          label="Area"
          value={filters.area ?? ""}
          onChange={(v) => set({ area: v || undefined })}
          options={toOptions(getPropertyAreas())}
          full={full}
        />
      </>
    )
  }

  if (type === "news") {
    return (
      <FilterSelect
        label="Category"
        value={filters.category ?? ""}
        onChange={(v) => set({ category: v || undefined })}
        options={toOptions(getNewsCategories())}
        full={full}
      />
    )
  }

  return null
}

/** Content-type filter chips + contextual filters/sort + clear action (UI/UX Spec §8, extended Phase 9B). */
function FilterControls({
  type,
  onTypeChange,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  onClear,
  showClear,
  layout = "inline",
}: FilterControlsProps) {
  const full = layout === "sheet"
  const showSort = type === "news"

  return (
    <Stack direction={full ? "column" : "row"} align={full ? "stretch" : "center"} wrap gap={2}>
      <ToggleGroup
        type="single"
        variant="outline"
        value={type}
        onValueChange={(value) => {
          if (value) onTypeChange(value as SearchResultKind | "all")
        }}
        aria-label="Filter by content type"
        className="w-full flex-wrap justify-start"
      >
        {searchTypeFilters.map((filter) => (
          <ToggleGroupItem key={filter.value} value={filter.value} aria-label={filter.label}>
            {filter.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ContextualFilters type={type} filters={filters} onFiltersChange={onFiltersChange} full={full} />

      {showSort && (
        <FilterSelect
          label="Sort"
          value={sort === "default" ? "" : sort}
          onChange={(v) => onSortChange((v || "default") as SortOption)}
          options={[{ value: "newest", label: "Newest" }]}
          placeholder="Default order"
          full={full}
        />
      )}

      {showClear && (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          <X />
          Clear filters
        </Button>
      )}
    </Stack>
  )
}

export { FilterControls }
