/**
 * The "open this card" control for a result card (Phase 9M accessibility fix). A card used to be a
 * `role="button"` element that CONTAINED the Save / WhatsApp / Contact buttons — interactive content
 * nested inside a button, which ARIA forbids and assistive technology handles poorly. The card is now
 * a plain container and this single, named button is stretched over it, so the whole card is still
 * clickable and looks the same; Save and the action buttons sit above it (z-20) as separate controls.
 * It is first in the DOM, so it is also the first stop in the keyboard order.
 *
 * The parent card must be `relative isolate` (positioning context + its own stacking context).
 * With no `onSelect` there is nothing to open, so nothing is rendered.
 */
interface CardPreviewTriggerProps {
  /** The item's own name/title — the accessible name becomes "Preview <name>". */
  name: string
  onSelect?: () => void
}

function CardPreviewTrigger({ name, onSelect }: CardPreviewTriggerProps) {
  if (!onSelect) return null
  return (
    <button
      type="button"
      aria-label={`Preview ${name}`}
      onClick={onSelect}
      className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}

export { CardPreviewTrigger }
