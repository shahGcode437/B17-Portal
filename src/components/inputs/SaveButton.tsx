import { Heart } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { useResidentStore, isItemSaved } from "@/state/residentStore"
import { routes } from "@/config/routes"
import { cn } from "@/lib/utils"
import type { SavedItemKind } from "@/types/resident"

interface SaveButtonProps {
  kind: SavedItemKind
  id: string
  /** Display name used in the toast and the accessible label — never invented, always the item's own name/title. */
  name: string
  className?: string
}

/**
 * Reusable save/unsave toggle (Phase 9C) — shared by every public card and
 * detail page so the auth-gating and store wiring exist in exactly one
 * place. Logged-out clicks redirect to Login preserving the current page as
 * `from`, matching the existing Request Service intent-preservation pattern;
 * the save action itself is not resumed after login (that would need a
 * per-item resume mechanism this phase doesn't add — see the phase report).
 * Saved state is shown by icon fill AND `aria-pressed`, not color alone.
 */
function SaveButton({ kind, id, name, className }: SaveButtonProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()
  const saved = useResidentStore((state) => isItemSaved(state.savedItems, kind, id))
  const toggleSaved = useResidentStore((state) => state.toggleSaved)

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user) {
      navigate(routes.login, { state: { from: `${location.pathname}${location.search}` } })
      return
    }
    show(saved ? `Removed ${name} from Saved` : `Saved ${name}`)
    toggleSaved(kind, id)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
      className={cn("bg-background/90 shadow-subtle backdrop-blur-sm hover:bg-background", className)}
    >
      <Heart className={cn(saved && "fill-destructive text-destructive")} aria-hidden="true" />
    </Button>
  )
}

export { SaveButton }
