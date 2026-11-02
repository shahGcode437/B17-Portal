import type { LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

interface WorkspaceEmptyProps {
  icon: LucideIcon
  message: string
  /** Real next step: a route that exists (`to`) or an in-page action such as clearing a filter (`onClick`). */
  action?: { label: string; to?: string; onClick?: () => void }
}

/** Compact inline empty state for a section inside an overview (the full-page `EmptyState` is for whole-page emptiness). */
function WorkspaceEmpty({ icon: Icon, message, action }: WorkspaceEmptyProps) {
  return (
    <Card variant="workspace" className="items-center gap-3 rounded-2xl border-dashed bg-muted/40 py-8 text-center shadow-none">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-background/70 text-muted-foreground ring-1 ring-border">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <Typography variant="body-sm" className="text-muted-foreground">
        {message}
      </Typography>
      {action?.to && (
        <Button asChild variant="outline" className="h-11">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
      {action?.onClick && (
        <Button type="button" variant="outline" className="h-11" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  )
}

export { WorkspaceEmpty }
