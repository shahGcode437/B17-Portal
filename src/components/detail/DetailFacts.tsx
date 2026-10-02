import type { LucideIcon } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

export interface DetailFact {
  icon: LucideIcon
  label: string
  value: string
  /** Span both columns — for values that tend to be long (e.g. an area name). */
  wide?: boolean
}

interface DetailFactsProps {
  facts: DetailFact[]
}

/**
 * Compact label/value grid of key facts. Callers pass only facts that really
 * exist for the item, so nothing is shown as "N/A"; an empty list renders nothing.
 */
function DetailFacts({ facts }: DetailFactsProps) {
  if (facts.length === 0) return null

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4">
      {facts.map(({ icon: Icon, label, value, wide }) => (
        <div key={label} className={cn("min-w-0", wide && "col-span-2")}>
          <Typography as="dt" variant="caption" className="flex items-center gap-1.5">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {label}
          </Typography>
          <Typography as="dd" variant="body-sm" className="mt-0.5 break-words font-medium">
            {value}
          </Typography>
        </div>
      ))}
    </dl>
  )
}

export { DetailFacts }
