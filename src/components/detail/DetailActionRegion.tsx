import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"

type DetailActionRegionProps =
  | {
      /** A REAL action (today only Provider's Request Service). It is the page's primary, persistent control. */
      action: ReactNode
      /** A short, true line under the action (shown from `lg`; on phones the region is a compact bar). */
      caption?: string
    }
  | {
      /** The honest state when no contact path exists yet: says so plainly and offers no control. */
      unavailableMessage: string
    }

/**
 * The detail page's action region (VR3): one pattern with two truthful states.
 *
 *  - `action`: a prominent glass region around a real button. Place it in `DetailLayout`'s `action` slot, which
 *    keeps it in view (pinned above the phone tab bar, pinned to the right column from `lg`).
 *  - `unavailableMessage`: a quiet inline note, placed inside the identity panel. No button, no link, nothing that
 *    looks like a contact control: Business, Food, Tutor and Property have no contact capability yet.
 *
 * When Contact Model v1 is built, a page switches from `unavailableMessage` to `action` (Contact Business, Order
 * Inquiry, Contact Tutor, Contact Lister) with no layout change. Until then nothing here pretends it exists.
 */
function DetailActionRegion(props: DetailActionRegionProps) {
  if ("unavailableMessage" in props) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-muted/70 p-3.5">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Typography variant="body-sm" className="text-muted-foreground">
          {props.unavailableMessage}
        </Typography>
      </div>
    )
  }

  return (
    <div className="glass-3 flex flex-col gap-2 rounded-2xl p-2.5 lg:p-4 [&>button]:h-12 [&>button]:w-full [&>button]:text-base [&>button]:font-semibold">
      {props.action}
      {props.caption && (
        <Typography variant="caption" className="hidden text-center lg:block">
          {props.caption}
        </Typography>
      )}
    </div>
  )
}

export { DetailActionRegion }
