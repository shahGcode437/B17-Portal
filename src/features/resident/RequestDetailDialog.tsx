import { useNavigate } from "react-router-dom"
import { MapPin, CalendarDays, Clock } from "lucide-react"
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
import { RequestStatusBadge } from "@/features/resident/RequestStatusBadge"
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
}

/** Detail view for a single resident request — Dialog-based, matching RequestServiceDialog/ResultPreviewDialog. */
function RequestDetailDialog({ request, onOpenChange }: RequestDetailDialogProps) {
  const navigate = useNavigate()

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {request && (
          <>
            <DialogHeader>
              <Stack direction="row" align="start" justify="between" gap={2}>
                <DialogTitle className="capitalize">{request.service}</DialogTitle>
                <RequestStatusBadge status={request.status} />
              </Stack>
              <DialogDescription>Requested from {request.providerName}</DialogDescription>
            </DialogHeader>

            <Stack gap={3} className="text-left">
              <Typography variant="body-sm">{request.details}</Typography>

              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">{request.area}</Typography>
              </Stack>

              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">
                  Preferred {dateFormatter.format(new Date(request.preferredDate))}
                  {request.preferredTime ? ` · ${request.preferredTime}` : ""}
                </Typography>
              </Stack>

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

              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                <Typography variant="caption">
                  Submitted {submittedFormatter.format(new Date(request.submittedAt))}
                </Typography>
              </Stack>

              <Typography variant="caption" className="text-muted-foreground">
                This is a prototype — the provider has not actually been notified, and status here
                does not change automatically.
              </Typography>
            </Stack>

            <DialogFooter>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  onOpenChange(false)
                  navigate(providerProfilePath(request.providerId))
                }}
              >
                View Provider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { RequestDetailDialog }
