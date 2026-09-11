import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { FilterControls } from "@/components/inputs/FilterControls"
import type { SearchResultKind } from "@/types/search"

interface FilterSheetProps {
  type: SearchResultKind | "all"
  onTypeChange: (type: SearchResultKind | "all") => void
  onClear: () => void
  showClear: boolean
  resultCount: number
}

/** Mobile bottom-sheet filter entry point (UI/UX Spec §8, §23 — mobile-only). */
function FilterSheet({ type, onTypeChange, onClear, showClear, resultCount }: FilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden">
          <SlidersHorizontal />
          Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            {resultCount} result{resultCount === 1 ? "" : "s"}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <FilterControls type={type} onTypeChange={onTypeChange} onClear={onClear} showClear={showClear} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { FilterSheet }
