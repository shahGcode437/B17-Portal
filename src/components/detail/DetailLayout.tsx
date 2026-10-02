import type { ReactNode } from "react"
import { motion } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { fadeUp } from "@/lib/motion"

interface DetailLayoutProps {
  onBack: () => void
  /** Cover region (DetailHero). */
  hero: ReactNode
  /** Identity + primary action (DetailSummary). Sits right under the hero on mobile; becomes a sticky side panel from `lg`. */
  summary: ReactNode
  /** Supporting information (DetailSection...). */
  children: ReactNode
  /** Honest demo disclaimer shown after the sections. */
  notice?: string
}

/**
 * Shared composition for consumer detail pages (Visual V3):
 * cover → identity/actions → supporting sections. DOM order matches the mobile
 * reading order; from `lg` the summary moves into a sticky right column
 * (pure CSS grid — no layout effects). Presentation only — each page decides
 * what goes in each slot.
 */
function DetailLayout({ onBack, hero, summary, children, notice }: DetailLayoutProps) {
  return (
    <Container className="py-6 sm:py-10">
      <motion.div {...fadeUp}>
        <Stack gap={4} className="mx-auto max-w-3xl lg:max-w-6xl">
          <button
            type="button"
            onClick={onBack}
            className="flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </button>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="lg:col-start-1 lg:row-start-1">{hero}</div>
            <div className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">{summary}</div>
            <Stack gap={8} className="lg:col-start-1 lg:row-start-2">
              {children}
              {notice && (
                <Typography variant="caption" className="rounded-xl bg-muted/50 p-4 text-muted-foreground">
                  {notice}
                </Typography>
              )}
            </Stack>
          </div>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { DetailLayout }
