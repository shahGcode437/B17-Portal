import { useNavigate } from "react-router-dom"
import { MapPin, CalendarDays, Clock, MessageCircle, FileText } from "lucide-react"
import type { ServiceRequestRecord } from "@/types/resident"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { RequestProgress } from "@/components/workspace/RequestProgress"
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
import { RequestHistory } from "@/features/resident/RequestHistory"
import { RequestActions } from "@/features/resident/RequestActions"
import { contactPreferenceLabel } from "@/config/requests"
import { providerProfilePath } from "@/config/routes"

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
const submittedFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

interface RequestDetailDialogProps {
  request: ServiceRequestRecord | null
  onOpenChange: (open: boolean) => void
  /** Called after a successful action so the list refreshes. */
  onChanged?: () => void
}

interface MetaRow {
  icon: typeof MapPin
  label: string
  value: string
}

/**
 * Detail view for a single request the resident sent (VR4 visuals; semantics unchanged). The fields come
 * from the list row; the history is read from `GET /requests/{id}` when the dialog opens. The resident can
 * cancel while the request is submitted or accepted (`RequestActions`). The Portal does not send
 * notifications, which the dialog says plainly.
 */
function RequestDetailDialog({ request, onOpenChange, onChanged }: RequestDetailDialogProps) {
  const navigate = useNavigate()
  const preference = contactPreferenceLabel(request?.preferredContactChannel)

  if (!request) return null

  const meta: MetaRow[] = [
    { icon: MapPin, label: "Area", value: request.area },
    {
      icon: CalendarDays,
      label: "Preferred",
      value: `${dateFormatter.format(new Date(request.preferredDate))}${request.preferredTime ? ` · ${request.preferredTime}` : ""}`,
    },
    { icon: Clock, label: "Submitted", value: submittedFormatter.format(new Date(request.submittedAt)) },
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
            Requested from <span className="font-medium text-foreground">{request.providerName}</span>
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

          <RequestHistory requestId={request.id} viewerRole="requester" />

          <RequestActions
            requestId={request.id}
            status={request.status}
            viewerRole="requester"
            onRefresh={() => onChanged?.()}
          />

          <Typography variant="caption" className="text-muted-foreground">
            The provider sees your request in their dashboard. B-17 Portal doesn't send
            notifications yet, so check back here for updates.
          </Typography>
        </Stack>

        {request.providerId && (
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => {
                onOpenChange(false)
                navigate(providerProfilePath(request.providerId ?? ""))
              }}
            >
              View Provider
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { RequestDetailDialog }
