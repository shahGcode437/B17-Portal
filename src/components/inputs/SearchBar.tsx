import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  size?: "hero" | "compact"
  className?: string
}

/** Search-first input (UI/UX Spec §7.1, §8) — shared by Home hero and Search/Explore. */
function SearchBar({ value, onChange, onSubmit, placeholder, size = "compact", className }: SearchBarProps) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(value)
      }}
      className={cn(
        "group flex w-full items-center gap-2 rounded-full border border-border bg-card shadow-subtle transition-all duration-200 focus-within:border-primary focus-within:shadow-elevated",
        size === "hero" ? "p-2" : "p-1",
        className
      )}
    >
      <Search
        className={cn("ml-3 shrink-0 text-muted-foreground", size === "hero" ? "size-5" : "size-4")}
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "What do you need in B-17?"}
        aria-label="Search B-17 Portal"
        className={cn(
          "border-0 bg-transparent shadow-none focus-visible:ring-0",
          size === "hero" ? "h-11 text-base" : "h-9 text-sm"
        )}
      />
      <Button type="submit" size={size === "hero" ? "default" : "sm"} className="mr-1 shrink-0 rounded-full">
        Search
      </Button>
    </form>
  )
}

export { SearchBar }
