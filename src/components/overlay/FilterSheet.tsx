import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet"
import { FilterControls } from "@/components/inputs/FilterControls"
import type { SearchResultKind, SearchFilters, SortOption } from "@/types/search"

interface FilterSheetProps {
  type: SearchResultKind | "all"
  onTypeChange: (type: SearchResultKind | "all") => void
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  onClear: () => void
  showClear: boolean
  resultCount: number
}

/**
 * Mobile bottom-sheet filter entry point (UI/UX Spec §8, §23 — mobile-only).
 * Filters still apply live (same callbacks as the desktop inline controls —
 * no separate draft/commit state to keep in sync), so "Apply" below simply
 * closes the sheet once the user is done; "Clear" resets and closes together.
 */
function FilterSheet({
  type,
  onTypeChange,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  onClear,
  showClear,
  resultCount,
}: FilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden">
          <SlidersHorizontal />
          Filters
          {showClear && <Badge variant="secondary">Active</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            {resultCount} result{resultCount === 1 ? "" : "s"}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-2">
          <FilterControls
            type={type}
            onTypeChange={onTypeChange}
            filters={filters}
            onFiltersChange={onFiltersChange}
            sort={sort}
            onSortChange={onSortChange}
            onClear={onClear}
            showClear={false}
            layout="sheet"
          />
        </div>
        <SheetFooter className="flex-row">
          <SheetClose asChild>
            <Button variant="outline" className="flex-1" onClick={onClear} disabled={!showClear}>
              Clear
            </Button>
          </SheetClose>
          <SheetClose asChild>
            <Button className="flex-1">Apply</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { FilterSheet }
