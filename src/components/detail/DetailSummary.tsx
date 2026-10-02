import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"

interface DetailSummaryProps {
  /** Small chips above the title (e.g. the Demo Listing badge). */
  badges?: ReactNode
  title: string
  /** Category/context line under the title. */
  subtitle?: string
  /** An honest, already-formatted headline value (e.g. a property's price string). */
  highlight?: string
  /** Key facts (DetailFacts) — shown after the actions so the primary action stays visible on small screens. */
  facts?: ReactNode
  /** The page's actions — the first one is the primary action. */
  actions: ReactNode
}

/**
 * Identity + primary action + key facts for a detail page. Non-interactive
 * surface (`default` Card): only the buttons inside are interactive. Long
 * titles wrap rather than overflow.
 */
function DetailSummary({ badges, title, subtitle, highlight, facts, actions }: DetailSummaryProps) {
  return (
    <Card variant="default" className="gap-5 p-5">
      <Stack gap={3}>
        {badges && <Stack direction="row" align="center" wrap gap={2}>{badges}</Stack>}
        <Stack gap={1}>
          <Typography as="h1" variant="h2" className="text-balance break-words">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body-lg" className="break-words text-primary">
              {subtitle}
            </Typography>
          )}
          {highlight && (
            <Typography variant="body-lg" className="break-words font-semibold">
              {highlight}
            </Typography>
          )}
        </Stack>
      </Stack>
      <Stack gap={2} className="[&>button]:h-11 [&>button]:w-full">
        {actions}
      </Stack>
      {facts}
    </Card>
  )
}

export { DetailSummary }
