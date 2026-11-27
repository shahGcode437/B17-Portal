import { cn } from "@/lib/utils"

/** Grocery forms are filled in on phones: every control is at least 44px tall at every width. */
export const groceryInputClass = "h-11 md:h-11 text-base md:text-base"

export const grocerySelectClass = cn(
  "h-11 w-full min-w-0 rounded-lg border border-input bg-card/60 px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
  "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
)

/** The ids a control points to with `aria-describedby`. */
export function describedBy(id: string, error?: string, hint?: boolean): string | undefined {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
}
