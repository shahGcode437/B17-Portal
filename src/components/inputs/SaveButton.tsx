import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/useToast"
import { useMutation } from "@/hooks/useMutation"
import { useSavedSet } from "@/hooks/useSavedSet"
import { useSignInGate } from "@/hooks/useSignInGate"
import { copyAsSentence, userMessageFor } from "@/lib/api/writeErrors"
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
 * Phase 12H: writes are real. An anonymous visitor is sent to Log In (with a safe return path) - and only an
 * ANONYMOUS one: while the session is still being checked, or the server cannot be reached, nobody is sent to
 * Log In (`useSignInGate`, Phase 12S). A signed-in user toggles `PUT /saved/{id}` / `DELETE /saved/{id}`
 * through `useSavedSet`, which
 * keeps the "which ids are saved" state in memory and shares it across every mounted button. The
 * server is the source of truth: the control reflects the real set, and a failure (e.g. the
 * listing is no longer approved) is announced plainly, not hidden.
 */
function SaveButton({ id, name, className }: SaveButtonProps) {
  const { show } = useToast()
  const { requireSignIn } = useSignInGate()
  const saved = useSavedSet()
  const isSaved = saved.isSaved(id)
  const toggle = useMutation(async (save: boolean) => {
    if (save) await saved.save(id)
    else await saved.unsave(id)
  })

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // What THIS click means is decided now: when it is held until /auth/me answers, the saved set has not
    // loaded yet, and re-reading it later must not flip the person's intent. Both writes are idempotent.
    const save = !isSaved
    requireSignIn(async () => {
      try {
        await toggle.mutate(save)
        show(save ? `Saved ${name}` : `Removed ${name} from saved`)
      } catch (error) {
        const copy = userMessageFor(error, save ? "save-listing" : "unsave-listing")
        show(copyAsSentence(copy), { tone: "error" })
      }
    })
  }

  const label = isSaved ? `Remove ${name} from saved` : `Save ${name}`
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={isSaved}
      disabled={toggle.pending}
      onClick={handleClick}
      className={cn(
        "bg-background/90 shadow-subtle backdrop-blur-sm hover:bg-background",
        isSaved ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      <Heart aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />
    </Button>
  )
}

export { SaveButton }
