import { MapPin, CalendarDays, MessageCircle } from "lucide-react"
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

/**
 * Lead detail for the provider (read-only in Phase 12G). The fields come from the inbox row; the
 * history is read from `GET /requests/{id}` when the dialog opens. The requester appears by display
 * name only - no e-mail or phone number exists on a request. Accept / start / complete / cancel are
 * wired to the API in Phase 12H, so this dialog offers no action that could pretend to work.
 */
function LeadDetailDialog({ request, onOpenChange, onChanged }: LeadDetailDialogProps) {
  const preference = contactPreferenceLabel(request?.preferredContactChannel)

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        {request && (
          <>
            <DialogHeader>
              <Stack direction="row" align="start" justify="between" gap={2} className="pr-8">
                <DialogTitle className="min-w-0 break-words capitalize">{request.service}</DialogTitle>
                <RequestStatusBadge status={request.status} />
              </Stack>
              <DialogDescription>Requested by {request.requestedBy}</DialogDescription>
            </DialogHeader>

            <Stack gap={4} className="text-left">
              <RequestProgress status={request.status} />

              <Typography variant="body-sm">{request.details}</Typography>

              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm" className="min-w-0 [overflow-wrap:anywhere]">
                  {request.area}
                </Typography>
              </Stack>

              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">
                  Preferred {dateFormatter.format(new Date(request.preferredDate))}
                  {request.preferredTime ? ` · ${request.preferredTime}` : ""}
                </Typography>
              </Stack>

              {preference && (
                <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                  <MessageCircle className="size-3.5 shrink-0" aria-hidden="true" />
                  <Typography variant="body-sm">{preference}</Typography>
                </Stack>
              )}

              {request.notes && (
                <Stack gap={1} className="rounded-lg bg-muted p-3">
                  <Typography variant="label" className="text-xs">
                    Additional details
                  </Typography>
                  <Typography variant="body-sm" className="text-muted-foreground">
                    {request.notes}
                  </Typography>
                </Stack>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { LeadDetailDialog }
