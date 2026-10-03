/**
 * Shared Admin control classes (kept as constants, like `features/provider/formStyles.ts`,
 * so the repeated pieces stay in one place without a wrapper component).
 */

/** Filter/segment toggle item: 44px on touch, compact from `sm`, with a selected state that isn't only a pale tint. */
export const segmentItemClass = `h-11 px-3 sm:h-8 data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground`

/** Row/dialog action button: 44px on touch, compact (default `Button` height) from `sm`. */
export const rowActionClass = "h-11 sm:h-8"

/** Strong, solid focus treatment for controls drawn on the dark Admin header (the shared green ring has too little contrast on the dark navy). */
export const headerFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
