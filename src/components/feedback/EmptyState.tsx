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
  /** Optional second, lower-emphasis way forward (e.g. widening a narrowed search). */
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}

/** Explains an empty result set and offers a concrete next action. */
function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  const hasPrimary = actionLabel && onAction
  const hasSecondary = secondaryActionLabel && onSecondaryAction

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
      {(hasPrimary || hasSecondary) && (
        <Stack direction="row" wrap justify="center" gap={2}>
          {hasPrimary && (
            <Button variant="outline" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {hasSecondary && (
            <Button variant="ghost" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  )
}

export { EmptyState }
