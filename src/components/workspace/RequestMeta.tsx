import { Calendar, CalendarClock, MapPin } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import { Typography } from "@/components/foundation/Typography"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

function MetaItem({ icon: Icon, children }: { icon: typeof Calendar; children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <Typography as="span" variant="caption" className="break-words">
        {children}
      </Typography>
    </span>
  )
}

/** Submitted date, preferred date and area for a request — the same real fields on both the Resident and Professional rows. */
function RequestMeta({ request }: { request: ServiceRequestRecord }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <MetaItem icon={Calendar}>{`Submitted ${dateFormatter.format(new Date(request.submittedAt))}`}</MetaItem>
      <MetaItem icon={CalendarClock}>{`Preferred ${dateFormatter.format(new Date(request.preferredDate))}`}</MetaItem>
      <MetaItem icon={MapPin}>{request.area}</MetaItem>
    </div>
  )
}

export { RequestMeta }
