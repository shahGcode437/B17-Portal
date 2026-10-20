import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/useToast"
import { cn } from "@/lib/utils"
import type { SavedItemKind } from "@/types/resident"

interface SaveButtonProps {
  kind: SavedItemKind
  id: string
  /** The item's own name, used in the accessible label - never invented. */
  name: string
  className?: string
}

/**
 * The heart on every public card and detail page.
 *
 * Phase 12G made the Saved LIST real (`GET /saved`), but saving and un-saving are wired to the API
 * in Phase 12H. Until then this control must not pretend: the old version toggled a browser-local
 * list that the server never saw, which would have shown items as saved that the real Saved page
 * does not contain. So it is a deliberately unavailable control - announced as such (aria-disabled,
 * still focusable so its explanation can be reached) and answering a press with an honest message.
 * `kind` and `id` stay in the signature so the 12H wiring changes this file only.
 */
function SaveButton({ name, className }: SaveButtonProps) {
  const { show } = useToast()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-disabled="true"
      aria-label={`Save ${name} (coming soon)`}
      title="Saving is coming soon"
      onClick={(event) => {
        event.stopPropagation()
        show("Saving items is coming soon.")
      }}
      className={cn("bg-background/90 text-muted-foreground shadow-subtle backdrop-blur-sm hover:bg-background", className)}
    >
      <Heart aria-hidden="true" />
    </Button>
  )
}

export { SaveButton }
