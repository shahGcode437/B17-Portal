import type { ReactNode } from "react"
import { useId } from "react"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"

interface WorkspaceSectionProps {
  title: string
  /** Optional right-aligned link, e.g. "View all". */
  actionLabel?: string
  actionTo?: string
  children: ReactNode
}

/** A titled region (h2 + optional "View all") shared by the Resident and Professional pages. */
function WorkspaceSection({ title, actionLabel, actionTo, children }: WorkspaceSectionProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <Stack gap={3}>
        <Stack direction="row" align="center" justify="between" gap={3}>
          <Typography as="h2" variant="label" id={headingId} className="font-heading text-lg font-semibold">
            {title}
          </Typography>
          {actionLabel && actionTo && (
            <Link
              to={actionTo}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {actionLabel}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </Stack>
        {children}
      </Stack>
    </section>
  )
}

export { WorkspaceSection }
