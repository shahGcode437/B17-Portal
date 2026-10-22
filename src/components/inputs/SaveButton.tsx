import { useNavigate } from "react-router-dom"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/useToast"
import { useAuth } from "@/hooks/useAuth"
import { useMutation } from "@/hooks/useMutation"
import { useSavedSet } from "@/hooks/useSavedSet"
import { userMessageFor } from "@/lib/api/writeErrors"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"
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
 * Phase 12H: writes are real. An anonymous visitor is sent to Log In (with a safe return path);
 * a signed-in user toggles `PUT /saved/{id}` / `DELETE /saved/{id}` through `useSavedSet`, which
 * keeps the "which ids are saved" state in memory and shares it across every mounted button. The
 * server is the source of truth: the control reflects the real set, and a failure (e.g. the
 * listing is no longer approved) is announced plainly, not hidden.
 */
function SaveButton({ id, name, className }: SaveButtonProps) {
  const { show } = useToast()
  const auth = useAuth()
  const navigate = useNavigate()
  const saved = useSavedSet()
  const isSaved = saved.isSaved(id)
  const toggle = useMutation(async () => {
    if (isSaved) await saved.unsave(id)
    else await saved.save(id)
  })

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (auth.status !== "authenticated") {
      navigate(routes.login, { state: { from: `${window.location.pathname}${window.location.search}` } })
      return
    }
    try {
      await toggle.mutate(undefined)
      show(isSaved ? `Removed ${name} from saved` : `Saved ${name}`)
    } catch (error) {
      const copy = userMessageFor(error, isSaved ? "unsave-listing" : "save-listing")
      show(copy.title)
    }
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
