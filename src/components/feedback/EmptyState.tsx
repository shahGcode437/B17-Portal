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
  /**
   * Heading level of the title. Defaults to 2 (an empty region inside a page
   * that already has an h1). Pass 1 when the empty state *is* the page — e.g. a
   * "not found" state that replaces the whole screen — so the page still has
   * exactly one h1 and no level is skipped.
   */
  headingLevel?: 1 | 2 | 3
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
  headingLevel = 2,
}: EmptyStateProps) {
  const hasPrimary = actionLabel && onAction
  const hasSecondary = secondaryActionLabel && onSecondaryAction

  return (
    <Stack align="center" gap={4} className="mx-auto max-w-md py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <Stack gap={1}>
        <Typography as={`h${headingLevel}` as const} variant="h3">
          {title}
        </Typography>
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
