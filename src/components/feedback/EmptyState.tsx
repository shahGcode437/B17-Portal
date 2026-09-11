import type { LucideIcon } from "lucide-react"
import { SearchX } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

/** Explains an empty result set and offers a concrete next action. */
function EmptyState({ icon: Icon = SearchX, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Stack align="center" gap={4} className="mx-auto max-w-md py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <Stack gap={1}>
        <Typography variant="h3">{title}</Typography>
        <Typography variant="body" className="text-muted-foreground">
          {description}
        </Typography>
      </Stack>
      {actionLabel && onAction && (
        <Button variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Stack>
  )
}

export { EmptyState }
