import { useState } from "react"
import { CheckCircle2, MessageCircle } from "lucide-react"
import type { Provider } from "@/types/provider"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ServiceRequestForm } from "@/features/services/ServiceRequestForm"
import type { ServiceRequestValues } from "@/features/services/serviceRequestSchema"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { useResidentStore } from "@/state/residentStore"

interface RequestServiceDialogProps {
  provider: Provider
  requesterName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })

/**
 * In-page Request Service flow (Provider Profile → form → confirmation).
 * On submit, a resident request-history record is created in `residentStore`
 * (Phase 9C — see "My Requests") and persisted locally via that store. There
 * is still no backend/server persistence and no provider-side status
 * transitions (Master Spec §19, Prototype Scope §12).
 */
function RequestServiceDialog({ provider, requesterName, open, onOpenChange }: RequestServiceDialogProps) {
  const [submitted, setSubmitted] = useState<ServiceRequestValues | null>(null)
  const { show } = useToast()
  const addRequest = useResidentStore((state) => state.addRequest)

  function handleSubmit(values: ServiceRequestValues) {
    setSubmitted(values)
    addRequest({
      id: crypto.randomUUID(),
      providerId: provider.id,
      providerName: provider.name,
      service: values.service,
      details: values.details,
      area: values.area,
      preferredDate: values.preferredDate,
      preferredTime: values.preferredTime,
      notes: values.notes,
      requestedBy: requesterName,
      submittedAt: new Date().toISOString(),
      status: "submitted",
    })
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      // Reset after the close animation so the form doesn't flash empty while closing.
      setTimeout(() => setSubmitted(null), 200)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {submitted ? (
          <Stack gap={4} className="items-center py-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success-text">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={1}>
              {/* A real DialogTitle/Description so the success view still has an accessible name. */}
              <DialogTitle className="text-xl">Request submitted successfully</DialogTitle>
              <DialogDescription>Your service request has been recorded for this demo.</DialogDescription>
            </Stack>

            <Stack gap={1} className="w-full rounded-lg bg-muted p-3 text-left">
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Provider:</span>{" "}
                <span className="font-medium">{provider.name}</span>
              </Typography>
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Service:</span>{" "}
                <span className="font-medium capitalize">{submitted.service}</span>
              </Typography>
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Preferred date:</span>{" "}
                <span className="font-medium">{dateFormatter.format(new Date(submitted.preferredDate))}</span>
              </Typography>
            </Stack>

            <Typography variant="caption" className="text-muted-foreground">
              This is a prototype — no real provider has been notified.
            </Typography>

            <Stack gap={2} className="w-full flex-col-reverse sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
                Back to Profile
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  handleOpenChange(false)
                  show(SIMULATED_MESSAGES.whatsapp)
                }}
              >
                <MessageCircle />
                Contact on WhatsApp
              </Button>
            </Stack>
          </Stack>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Request {provider.name}</DialogTitle>
              <DialogDescription>
                Share a few details and this demo will simulate sending your request.
              </DialogDescription>
            </DialogHeader>
            <ServiceRequestForm
              provider={provider}
              requesterName={requesterName}
              onCancel={() => handleOpenChange(false)}
              onSubmit={handleSubmit}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { RequestServiceDialog }
