import { MapPin, CalendarDays } from "lucide-react"
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
import { REQUEST_TRANSITIONS } from "@/features/provider/requestTransitions"
import { useResidentStore } from "@/state/residentStore"
import { useToast } from "@/hooks/useToast"
import { useRequireOnline } from "@/hooks/useRequireOnline"

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })

interface LeadDetailDialogProps {
  request: ServiceRequestRecord | null
  onOpenChange: (open: boolean) => void
}

/**
 * Lead detail + manual status transitions (Phase 9D). Writes go through
 * `residentStore.updateRequestStatus` — the same record the resident's My
 * Requests reads — so both sides stay in sync with no duplicate state.
 */
function LeadDetailDialog({ request, onOpenChange }: LeadDetailDialogProps) {
  const updateRequestStatus = useResidentStore((state) => state.updateRequestStatus)
  const { show } = useToast()
  const requireOnline = useRequireOnline()

  function handleTransition(next: ServiceRequestRecord["status"], label: string) {
    if (!request || !requireOnline()) return
    updateRequestStatus(request.id, next)
    show(`${label}: marked as ${next.replace("-", " ")} (demo)`)
    onOpenChange(false)
  }

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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

              <Typography variant="caption" className="text-muted-foreground">
                This is a prototype — status changes are local to this demo session and are not
                sent to the resident in real time (they'll see the update next time they open My
                Requests).
              </Typography>
            </Stack>

            {REQUEST_TRANSITIONS[request.status].length > 0 && (
              <DialogFooter className="gap-2 sm:gap-2">
                {REQUEST_TRANSITIONS[request.status].map(({ next, label }) => (
                  <Button
                    key={next}
                    variant={next === "cancelled" ? "destructive" : "default"}
                    className="h-11 flex-1"
                    onClick={() => handleTransition(next, label)}
                  >
                    {label}
                  </Button>
                ))}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { LeadDetailDialog }
