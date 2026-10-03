import { cn } from "@/lib/utils"

/** Shared native-`<select>` styling for onboarding forms (kept out of a component file so exporting it doesn't trip the fast-refresh lint rule). */
export const selectClassName = cn(
  "h-11 w-full min-w-0 md:h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
  "md:text-sm dark:bg-input/30"
)
