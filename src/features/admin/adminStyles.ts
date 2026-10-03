/**
 * Shared Admin control classes (kept as constants, like `features/provider/formStyles.ts`,
 * so the repeated pieces stay in one place without a wrapper component).
 */

/**
 * Solid focus ring for Admin controls. The shared `Button`/`Toggle`/`Input`
 * default is a 50%-alpha ring (about 1.9:1 on white); this overrides only its
 * color (and adds a gap so it separates from filled buttons), without touching
 * the global token.
 */
export const focusRingClass = "focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2"

/** Filter/segment toggle item: 44px on touch, compact from `sm`, with a selected state that isn't only a pale tint. */
export const segmentItemClass = `h-11 px-3 sm:h-8 data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:font-semibold data-[state=on]:text-accent-foreground ${focusRingClass}`

/** Row/dialog action button: 44px on touch, compact (default `Button` height) from `sm`. */
export const rowActionClass = `h-11 sm:h-8 ${focusRingClass}`

/** Text input: 44px on touch, default height from `md`, solid focus ring. */
export const inputClass = "h-11 md:h-8 focus-visible:ring-ring"

/** Strong, solid focus treatment for controls drawn on the dark Admin header (the default 50%-alpha ring is invisible there). */
export const headerFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
