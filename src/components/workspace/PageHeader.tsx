import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { motion } from "motion/react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { fadeUp } from "@/lib/motion"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  /** A small icon tile beside the title that cues the surface (operational, not decorative). */
  icon?: LucideIcon
  /** A small context chip above the title (e.g. "Admin" / "Professional"). */
  eyebrow?: string
  /** One or more operational controls (New listing, Review queue, Log out...). */
  actions?: ReactNode
  /** A dense context strip under the description (counts, filter chips, tabs the page owns). */
  meta?: ReactNode
  className?: string
}

/**
 * Shared operational page header (VR4). One grammar across the Professional, Admin and Resident
 * workspaces: an optional icon tile + eyebrow + title + description on the left, operational actions
 * pinned to the right (wrap underneath on phones), and an optional meta strip at the bottom. The
 * primary action is always the FIRST child of `actions`; wrap destructive ones in `variant="outline"`
 * / `"destructive"` so hierarchy stays visible.
 */
function PageHeader({ title, description, icon: Icon, eyebrow, actions, meta, className }: PageHeaderProps) {
  return (
    <motion.header {...fadeUp} className={cn("flex flex-col gap-4", className)}>
      <Stack direction="row" align="start" justify="between" gap={4} wrap>
        <Stack direction="row" align="start" gap={3} className="min-w-0 flex-1">
          {Icon && (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <Icon className="size-5" aria-hidden="true" />
            </span>
          )}
          <Stack gap={1} className="min-w-0">
            {eyebrow && (
              <Typography as="span" variant="caption" className="font-medium uppercase tracking-wider text-primary">
                {eyebrow}
              </Typography>
            )}
            <Typography variant="h1" className="text-balance text-2xl sm:text-3xl">
              {title}
            </Typography>
            {description && (
              <Typography variant="body" className="text-muted-foreground">
                {description}
              </Typography>
            )}
          </Stack>
        </Stack>
        {actions && <Stack direction="row" align="center" wrap gap={2} className="shrink-0">{actions}</Stack>}
      </Stack>
      {meta}
    </motion.header>
  )
}

export { PageHeader }
