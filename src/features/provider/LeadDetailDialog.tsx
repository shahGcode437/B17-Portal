import { MapPin, CalendarDays, MessageCircle, FileText } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { RequestProgress } from "@/components/workspace/RequestProgress"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { RequestHistory } from "@/features/resident/RequestHistory"
import { RequestActions } from "@/features/resident/RequestActions"
import { contactPreferenceLabel } from "@/config/requests"

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })

interface LeadDetailDialogProps {
  request: ServiceRequestRecord | null
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

interface MetaRow {
  icon: typeof MapPin
  label: string
  value: string
}

/**
 * Lead detail for the provider (VR4 visuals; semantics unchanged). The fields come from the inbox row;
 * the history is read from `GET /requests/{id}` when the dialog opens. The requester appears by display
 * name only — no e-mail or phone number exists on a request. Accept / start / complete / cancel are the
 * real actions (`RequestActions`); the Portal does not send notifications, which the dialog says plainly.
 */
function LeadDetailDialog({ request, onOpenChange, onChanged }: LeadDetailDialogProps) {
  const preference = contactPreferenceLabel(request?.preferredContactChannel)

  if (!request) return null

  const meta: MetaRow[] = [
    { icon: MapPin, label: "Area", value: request.area },
    {
      icon: CalendarDays,
      label: "Preferred",
      value: `${dateFormatter.format(new Date(request.preferredDate))}${request.preferredTime ? ` · ${request.preferredTime}` : ""}`,
    },
  ]
  if (preference) meta.push({ icon: MessageCircle, label: "Preferred contact", value: preference })

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <Stack direction="row" align="start" justify="between" gap={2} className="pr-8">
            <DialogTitle className="min-w-0 break-words capitalize">{request.service}</DialogTitle>
            <RequestStatusBadge status={request.status} />
          </Stack>
          <DialogDescription>
            Requested by <span className="font-medium text-foreground">{request.requestedBy}</span>
          </DialogDescription>
        </DialogHeader>

        <Stack gap={6} className="text-left">
          <RequestProgress status={request.status} />

          {request.details && (
            <section aria-label="Need" className="rounded-xl bg-secondary/60 p-3.5 ring-1 ring-border/60">
              <Stack direction="row" align="start" gap={2}>
                <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <Typography variant="body-sm" className="min-w-0">
                  {request.details}
                </Typography>
              </Stack>
            </section>
          )}

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {meta.map(({ icon: Icon, label, value }) => (
              <div key={label} className="min-w-0 rounded-xl bg-secondary/60 p-3">
                <Typography as="dt" variant="caption" className="flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {label}
                </Typography>
                <Typography as="dd" variant="body-sm" className="mt-0.5 break-words font-semibold">
                  {value}
                </Typography>
              </div>
            ))}
          </dl>

          {request.notes && (
            <section aria-label="Additional details" className="rounded-xl bg-muted/70 p-3.5">
              <Typography variant="caption" className="font-semibold uppercase tracking-wide">
                Additional details
              </Typography>
              <Typography variant="body-sm" className="mt-1 text-muted-foreground">
                {request.notes}
              </Typography>
            </section>
          )}

          <RequestHistory requestId={request.id} viewerRole="provider" />

          <RequestActions
            requestId={request.id}
            status={request.status}
            viewerRole="provider"
            onRefresh={() => onChanged?.()}
          />

          <Typography variant="caption" className="text-muted-foreground">
            B-17 Portal doesn't send the requester a notification yet. The status change will show up when they open
            this request again.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export { LeadDetailDialog }
