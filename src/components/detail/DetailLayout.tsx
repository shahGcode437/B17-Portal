import type { ReactNode } from "react"
import { motion } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { fadeUp } from "@/lib/motion"
import { cn } from "@/lib/utils"

interface DetailLayoutProps {
  onBack: () => void
  /** Cover region (DetailHero variant="banner"). */
  hero: ReactNode
  /** Identity panel (DetailSummary). Overlaps the bottom of the hero. */
  summary: ReactNode
  /**
   * The page's one persistent, real action (DetailActionRegion `action`): Provider's Request Service. Pinned above the
   * phone tab bar while the page scrolls, and to the top of the right column from `lg`. Omit it when the page has no
   * real action: the summary then stays pinned instead.
   */
  action?: ReactNode
  /** Supporting information (DetailSection...). */
  children: ReactNode
  /** Honest disclaimer shown after the sections. */
  notice?: string
}

/**
 * Shared composition for listing detail pages (Visual V3, deepened in VR3):
 * hero banner -> identity panel (overlapping it) -> supporting sections -> the persistent action.
 * DOM order is the mobile reading order and the order the pinned action belongs in (last, so a bottom-sticky bar
 * can pin to the viewport and settle at the end of the content instead of covering the footer). From `lg` the
 * hero spans the page and the identity panel and action sit in a 22rem right column, placed purely by CSS grid.
 * Presentation only: each page decides what goes in each slot.
 */
function DetailLayout({ onBack, hero, summary, action, children, notice }: DetailLayoutProps) {
  return (
    <Container className="py-6 sm:py-10">
      <motion.div {...fadeUp}>
        <Stack gap={4} className="mx-auto max-w-3xl lg:max-w-6xl">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-11 w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </button>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto_1fr] lg:items-start">
            <div className="lg:col-span-2 lg:row-start-1">{hero}</div>
            <div
              className={cn(
                "relative z-10 -mt-14 px-3 sm:px-6 lg:col-start-2 lg:row-start-2 lg:-mt-36 lg:px-0",
                !action && "lg:row-span-2 lg:sticky lg:top-24"
              )}
            >
              {summary}
            </div>
            <Stack gap={6} className="lg:col-start-1 lg:row-span-2 lg:row-start-2">
              {children}
              {notice && (
                <Typography variant="caption" className="rounded-xl bg-muted/50 p-4 text-muted-foreground">
                  {notice}
                </Typography>
              )}
            </Stack>
            {action && (
              <div className="sticky bottom-[4.75rem] z-20 lg:bottom-auto lg:top-24 lg:col-start-2 lg:row-start-3">{action}</div>
            )}
          </div>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { DetailLayout }
