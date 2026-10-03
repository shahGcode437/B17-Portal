import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card"

type SelectableCardProps = {
  children: ReactNode
} & ({ onSelect: () => void; to?: never } | { to: string; onSelect?: never })

const targetClasses = "flex w-full flex-col gap-3 rounded-xl p-4 text-left outline-none"

/**
 * Workspace list row that opens a detail view (`onSelect`, a real `<button>`)
 * or navigates (`to`, a real `<a>`). The surface is the shared `Card`
 * (workspace variant); the click target is a full-bleed native element inside
 * it, so keyboard/AT behavior is native — Card itself never becomes a fake
 * button. The focus ring is drawn on the card via `:has(:focus-visible)` at
 * full strength (the 50%-alpha default ring is only ~1.9:1 on white).
 */
function SelectableCard({ children, onSelect, to }: SelectableCardProps) {
  return (
    <Card
      variant="workspace"
      className="p-0 transition-colors hover:border-primary/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
    >
      {to ? (
        <Link to={to} className={targetClasses}>
          {children}
        </Link>
      ) : (
        <button type="button" onClick={onSelect} className={targetClasses}>
          {children}
        </button>
      )}
    </Card>
  )
}

export { SelectableCard }
