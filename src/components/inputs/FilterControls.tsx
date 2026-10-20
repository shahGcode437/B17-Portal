import { X } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { cn } from "@/lib/utils"
import { searchTypeFilters } from "@/config/search"
import { FOOD_SERVICE_OPTIONS, FOOD_VERTICAL_LABEL } from "@/config/food"
import { useCategories } from "@/hooks/useCategories"
import type { CategoryModule } from "@/lib/api/dto/public"
import type { SearchResultKind, SearchFilters, SortOption } from "@/types/search"

/** The minimum-bedroom choices offered (the API accepts 1-20; these cover real homes). */
const BEDROOM_OPTIONS = [1, 2, 3, 4, 5]
const FURNISHED_OPTIONS: NonNullable<SearchFilters["furnished"]>[] = ["Furnished", "Semi-Furnished", "Unfurnished"]
const LISTING_TYPES: NonNullable<SearchFilters["listingType"]>[] = ["sale", "rent"]

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
  "h-11 min-w-0 md:h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
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

/**
 * One labeled `<select>` filter field. Option lists come from the backend (categories, facets),
 * never from local data. A value that is in the URL but not (yet) in the list - a deep link, or the
 * list still loading - stays selectable instead of silently showing "Any".
 */
function FilterSelect({ label, value, onChange, options, full, placeholder }: FilterSelectProps) {
  const shown = value && !options.some((option) => option.value === value) ? [{ value, label: value }, ...options] : options
  return (
    <select
      aria-label={label}
      className={cn(selectClassName, full ? "w-full" : "w-auto")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder ?? `Any ${label}`}</option>
      {shown.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/*
 * Area and tutor Grade are deliberately NOT offered as dropdowns (Phase 12G review). They are free
 * text on a listing, no endpoint enumerates them, and building the list from one page of search
 * results would silently omit legitimate values. A URL that carries `area=` / `grade=` still filters
 * (and shows a removable chip); a proper picker waits for a backend facets endpoint (see DECISIONS.md).
 */

/** `GET /categories` as select options: the value is the category SLUG, the label its current name. */
function useCategoryOptions(module: CategoryModule, enabled = true): { value: string; label: string }[] {
  const read = useCategories(module, { enabled })
  return read.status === "success" ? read.data.map((category) => ({ value: category.slug, label: category.name })) : []
}

interface FiltersProps {
  filters: SearchFilters
  set: (patch: Partial<SearchFilters>) => void
  full?: boolean
}

function ProviderFilters({ filters, set, full }: FiltersProps) {
  const categories = useCategoryOptions("services")
  return (
    <>
      <FilterSelect label="Category" value={filters.category ?? ""} onChange={(v) => set({ category: v || undefined })} options={categories} full={full} />
    </>
  )
}

function BusinessFilters({ filters, set, full }: FiltersProps) {
  const isFood = filters.vertical === "food"
  // Only the list this scope shows is requested (general categories and Food categories are different modules).
  const general = useCategoryOptions("directory", !isFood)
  const food = useCategoryOptions("food", isFood)
  return (
    <>
      <FilterSelect
        label="Business Type"
        value={filters.vertical ?? ""}
        onChange={(v) =>
          // Changing the scope resets the dependent fields: general categories and Food filters have different value spaces.
          set({
            vertical: (v || undefined) as SearchFilters["vertical"],
            category: undefined,
            foodCategory: undefined,
            service: undefined,
          })
        }
        options={[
          { value: "general", label: "General" },
          { value: "food", label: FOOD_VERTICAL_LABEL },
        ]}
        full={full}
      />
      {isFood ? (
        <>
          <FilterSelect
            label="Food Category"
            value={filters.foodCategory ?? ""}
            onChange={(v) => set({ foodCategory: v || undefined })}
            options={food}
            full={full}
          />
          <FilterSelect
            label="Service"
            value={filters.service ?? ""}
            onChange={(v) => set({ service: (v || undefined) as SearchFilters["service"] })}
            options={FOOD_SERVICE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            full={full}
          />
        </>
      ) : (
        <FilterSelect label="Category" value={filters.category ?? ""} onChange={(v) => set({ category: v || undefined })} options={general} full={full} />
      )}
    </>
  )
}

function TutorFilters({ filters, set, full }: FiltersProps) {
  const subjects = useCategoryOptions("education")
  return (
    <>
      <FilterSelect label="Subject" value={filters.subject ?? ""} onChange={(v) => set({ subject: v || undefined })} options={subjects} full={full} />
    </>
  )
}

function PropertyFilters({ filters, set, full }: FiltersProps) {
  const types = useCategoryOptions("property")
  return (
    <>
      <FilterSelect
        label="Listing Type"
        value={filters.listingType ?? ""}
        onChange={(v) => set({ listingType: (v || undefined) as SearchFilters["listingType"] })}
        options={LISTING_TYPES.map((t) => ({ value: t, label: t === "sale" ? "Sale" : "Rent" }))}
        full={full}
      />
      <FilterSelect label="Property Type" value={filters.propertyType ?? ""} onChange={(v) => set({ propertyType: v || undefined })} options={types} full={full} />
      <FilterSelect
        label="Bedrooms"
        value={filters.minBedrooms ? String(filters.minBedrooms) : ""}
        onChange={(v) => set({ minBedrooms: v ? Number(v) : undefined })}
        options={BEDROOM_OPTIONS.map((n) => ({ value: String(n), label: `${n}+` }))}
        full={full}
      />
      <FilterSelect
        label="Furnishing"
        value={filters.furnished ?? ""}
        onChange={(v) => set({ furnished: (v || undefined) as SearchFilters["furnished"] })}
        options={FURNISHED_OPTIONS.map((f) => ({ value: f, label: f }))}
        full={full}
      />
    </>
  )
}

function NewsFilters({ filters, set, full }: FiltersProps) {
  const categories = useCategoryOptions("news")
  return (
    <FilterSelect label="Category" value={filters.category ?? ""} onChange={(v) => set({ category: v || undefined })} options={categories} full={full} />
  )
}

/** Contextual filter fields for the currently-selected result type - nothing renders for "all" or a type with no honest filters to offer. */
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
  switch (type) {
    case "provider":
      return <ProviderFilters filters={filters} set={set} full={full} />
    case "business":
      return <BusinessFilters filters={filters} set={set} full={full} />
    case "tutor":
      return <TutorFilters filters={filters} set={set} full={full} />
    case "property":
      return <PropertyFilters filters={filters} set={set} full={full} />
    case "news":
      return <NewsFilters filters={filters} set={set} full={full} />
    default:
      return null
  }
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
          <ToggleGroupItem
            key={filter.value}
            value={filter.value}
            aria-label={filter.label}
            className="data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90"
          >
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
