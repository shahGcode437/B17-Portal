import type { ReactNode } from "react"
import { useId } from "react"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"

interface WorkspaceSectionProps {
  title: string
  /** A quiet one-line hint under the title. */
  description?: string
  /** A count chip beside the title (e.g. 5 active leads). Hidden from assistive tech since the title can carry the count too. */
  count?: number
  /** Optional right-aligned link, e.g. "View all". */
  actionLabel?: string
  actionTo?: string
  children: ReactNode
}

/** A titled region (h2 + optional count chip + "View all") shared by the Resident, Professional and Admin pages. */
function WorkspaceSection({ title, description, count, actionLabel, actionTo, children }: WorkspaceSectionProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <Stack gap={3}>
        <Stack direction="row" align="center" justify="between" gap={3} wrap>
          <Typography as="h2" variant="label" id={headingId} className="font-heading text-lg font-semibold">
            {title}
            {typeof count === "number" && (
              <>
                {" "}
                <span className="font-normal tabular-nums text-muted-foreground">{`(${count})`}</span>
              </>
            )}
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
        {description && (
          <Typography variant="body-sm" className="text-muted-foreground">
            {description}
          </Typography>
        )}
        {children}
      </Stack>
    </section>
  )
}

export { WorkspaceSection }
