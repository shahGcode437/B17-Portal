import { Typography } from "@/components/foundation/Typography"
import type { DetailFact } from "@/components/detail/DetailFacts"
import { cn } from "@/lib/utils"

interface DetailFactTilesProps {
  facts: DetailFact[]
}

/**
 * The listing's key facts as scannable tiles (VR3): an icon, a quiet label and a bold value on an opaque tile, so
 * the numbers stay readable on the glass identity panel. Callers pass only facts that really exist, so nothing is
 * shown as "N/A"; an empty list renders nothing. A lone last tile spans the row.
 */
function DetailFactTiles({ facts }: DetailFactTilesProps) {
  if (facts.length === 0) return null

  return (
    <dl className="grid grid-cols-2 gap-2.5 [&>*:last-child:nth-child(odd)]:col-span-2">
      {facts.map(({ icon: Icon, label, value, wide }) => (
        <div key={label} className={cn("min-w-0 rounded-xl bg-secondary/60 p-3", wide && "col-span-2")}>
          <Typography as="dt" variant="caption" className="flex items-center gap-1.5 font-medium">
            <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            {label}
          </Typography>
          <Typography as="dd" variant="body-sm" className="mt-1 break-words font-semibold">
            {value}
          </Typography>
        </div>
      ))}
    </dl>
  )
}

export { DetailFactTiles }
