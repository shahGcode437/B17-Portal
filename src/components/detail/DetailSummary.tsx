import type { ReactNode } from "react"
import { MapPin } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"

interface DetailSummaryProps {
  title: string
  /** Category/context line under the title. */
  subtitle?: string
  /** An honest, already-formatted headline value (e.g. a property's price string). */
  highlight?: string
  /** The listing's area (always public), shown as the location line. */
  area: string
  /** Key facts (DetailFactTiles). */
  facts?: ReactNode
  /** The inline action region (the truthful unavailable-contact note). A real, persistent action goes in DetailLayout's `action` slot instead. */
  actions?: ReactNode
}

/**
 * The identity panel of a detail page (VR3): an elevated Level-3 glass surface that overlaps the hero, with the
 * editorial title, the category, an optional headline value (price), the location and the key facts. It is a
 * non-interactive surface: only controls passed in are interactive. Long titles wrap rather than overflow.
 */
function DetailSummary({ title, subtitle, highlight, area, facts, actions }: DetailSummaryProps) {
  return (
    <div className="glass-3 flex flex-col gap-5 rounded-2xl p-5 sm:p-6">
      <Stack gap={2}>
        <Typography as="h1" variant="h2" className="text-balance break-words">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body-lg" className="break-words font-medium text-primary">
            {subtitle}
          </Typography>
        )}
        {highlight && (
          <Typography as="p" variant="h3" className="break-words font-bold text-primary">
            {highlight}
          </Typography>
        )}
        <Typography as="p" variant="body-sm" className="flex items-start gap-1.5 text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{area}</span>
        </Typography>
      </Stack>
      {facts}
      {actions}
    </div>
  )
}

export { DetailSummary }
