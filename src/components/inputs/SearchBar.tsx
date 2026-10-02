import { useEffect, useId, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SearchSuggestionList } from "@/components/inputs/SearchSuggestionList"
import { cn } from "@/lib/utils"
import type { SearchSuggestion } from "@/types/search"

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  size?: "hero" | "compact"
  className?: string
  /** Predictive suggestions for the current text. Passing `onSuggestionSelect` turns the bar into an accessible combobox; without it the bar is a plain search box. */
  suggestions?: SearchSuggestion[]
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void
}

const NO_SUGGESTIONS: SearchSuggestion[] = []

const optionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`

/** Search-first input (UI/UX Spec §7.1, §8) — shared by Home hero and Search/Explore. */
function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  size = "compact",
  className,
  suggestions = NO_SUGGESTIONS,
  onSuggestionSelect,
}: SearchBarProps) {
  const listboxId = useId()
  const rootRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const isCombobox = Boolean(onSuggestionSelect)
  const showList = isCombobox && open && suggestions.length > 0

  function close() {
    setOpen(false)
    setActiveIndex(-1)
  }

  // Outside taps/clicks close the list. Input blur covers Tab-out, but not
  // every touch browser blurs on a tap over non-focusable page content.
  useEffect(() => {
    if (!showList) return
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [showList])

  useEffect(() => {
    if (showList && activeIndex >= 0) {
      document.getElementById(optionId(listboxId, activeIndex))?.scrollIntoView({ block: "nearest" })
    }
  }, [showList, activeIndex, listboxId])

  function handleChange(next: string) {
    onChange(next)
    setOpen(true)
    setActiveIndex(-1)
  }

  function selectSuggestion(suggestion: SearchSuggestion) {
    close()
    onSuggestionSelect?.(suggestion)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isCombobox) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length === 0) return
      event.preventDefault()
      const last = suggestions.length - 1
      if (!showList) {
        setOpen(true)
        setActiveIndex(event.key === "ArrowDown" ? 0 : last)
      } else if (event.key === "ArrowDown") {
        setActiveIndex((index) => (index >= last ? 0 : index + 1))
      } else {
        setActiveIndex((index) => (index <= 0 ? last : index - 1))
      }
    } else if (event.key === "Enter") {
      // Only intercept Enter when a suggestion is highlighted; otherwise the
      // form submits the typed text exactly as it always has.
      if (showList && activeIndex >= 0) {
        event.preventDefault()
        selectSuggestion(suggestions[activeIndex])
      }
    } else if (event.key === "Escape") {
      // Prevent the browser's own "clear a search field on Escape" while the list is open.
      if (showList) {
        event.preventDefault()
        close()
      }
    }
  }

  return (
    <form
      ref={rootRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        close()
        onSubmit?.(value)
      }}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-full border border-border bg-card shadow-subtle transition-all duration-200 focus-within:border-primary focus-within:shadow-elevated",
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
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={close}
        placeholder={placeholder ?? "What do you need in B-17?"}
        aria-label="Search B-17 Portal"
        enterKeyHint="search"
        autoComplete="off"
        {...(isCombobox && {
          role: "combobox",
          "aria-autocomplete": "list" as const,
          "aria-expanded": showList,
          "aria-controls": showList ? listboxId : undefined,
          "aria-activedescendant": showList && activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined,
        })}
        className={cn(
          "border-0 bg-transparent shadow-none focus-visible:ring-0",
          size === "hero" ? "h-11 text-base" : "h-9 text-base md:text-sm"
        )}
      />
      <Button type="submit" size={size === "hero" ? "default" : "sm"} className="mr-1 shrink-0 rounded-full">
        Search
      </Button>
      {isCombobox && (
        <span role="status" aria-live="polite" className="sr-only">
          {showList
            ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} available. Use the up and down arrow keys to review them.`
            : ""}
        </span>
      )}
      {showList && (
        <SearchSuggestionList
          id={listboxId}
          suggestions={suggestions}
          activeIndex={activeIndex}
          getOptionId={(index) => optionId(listboxId, index)}
          onSelect={selectSuggestion}
        />
      )}
    </form>
  )
}

export { SearchBar }
