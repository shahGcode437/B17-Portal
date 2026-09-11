import { X } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Stack } from "@/components/foundation/Stack"
import { searchTypeFilters } from "@/config/search"
import type { SearchResultKind } from "@/types/search"

interface FilterControlsProps {
  type: SearchResultKind | "all"
  onTypeChange: (type: SearchResultKind | "all") => void
  onClear: () => void
  showClear: boolean
}

/** Content-type filter chips + clear action (UI/UX Spec §8). */
function FilterControls({ type, onTypeChange, onClear, showClear }: FilterControlsProps) {
  return (
    <Stack direction="row" align="center" wrap gap={2}>
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
