import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
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
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { useMutation } from "@/hooks/useMutation"
import { createRequest } from "@/lib/api/writes/requests"
import { userMessageFor } from "@/lib/api/writeErrors"
import { fieldErrors, isApiError } from "@/lib/api/errors"

interface RequestServiceDialogProps {
  provider: Provider
  requesterName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })

/**
 * In-page Request Service flow (Phase 12H). Submits to `POST /requests` (API_CONTRACT §10.8). The
 * backend derives the provider from the listing's owner, enforces eligibility (approved provider
 * listing, not the requester's own), and rate-limits. No local request record is created — the
 * server is the source of truth. On success the dialog shows the real backend-returned record and
 * links to "My Requests".
 */
function RequestServiceDialog({ provider, requesterName, open, onOpenChange }: RequestServiceDialogProps) {
  const [submittedValues, setSubmittedValues] = useState<ServiceRequestValues | null>(null)
  const requireOnline = useRequireOnline()
  const submit = useMutation(createRequest)
  const [fieldErrorMap, setFieldErrorMap] = useState<Record<string, string>>({})

  async function handleSubmit(values: ServiceRequestValues) {
    if (!requireOnline()) return
    setFieldErrorMap({})
    try {
      await submit.mutate({
        providerListingId: provider.id,
        service: values.service,
        details: values.details,
        area: values.area,
        preferredDate: values.preferredDate,
        ...(values.preferredTime ? { preferredTime: values.preferredTime } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        preferredContactChannel: values.preferredContactChannel,
      })
      setSubmittedValues(values)
    } catch (error) {
      if (isApiError(error) && error.code === "validation_error") {
        setFieldErrorMap(fieldErrors(error))
      }
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setTimeout(() => {
        setSubmittedValues(null)
        submit.reset()
        setFieldErrorMap({})
      }, 200)
    }
  }

  const errorCopy = submit.status === "error" ? userMessageFor(submit.error, "create-request") : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {submittedValues ? (
          <Stack gap={4} className="items-center py-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success-text">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={1}>
              <DialogTitle className="text-xl">Request sent</DialogTitle>
              <DialogDescription>Your request has been sent to the provider.</DialogDescription>
            </Stack>
            <Stack gap={1} className="w-full rounded-lg bg-muted p-3 text-left">
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Provider:</span>{" "}
                <span className="font-medium">{provider.name}</span>
              </Typography>
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Service:</span>{" "}
                <span className="font-medium capitalize">{submittedValues.service}</span>
              </Typography>
              <Typography variant="body-sm">
                <span className="text-muted-foreground">Preferred date:</span>{" "}
                <span className="font-medium">{dateFormatter.format(new Date(submittedValues.preferredDate))}</span>
              </Typography>
            </Stack>
            <Button className="w-full" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </Stack>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Request {provider.name}</DialogTitle>
              <DialogDescription>
                Share a few details and the provider will see your request. B-17 Portal does not pass on phone or
                WhatsApp numbers; your preferred contact method is a hint only.
              </DialogDescription>
            </DialogHeader>
            {errorCopy && (
              <Typography variant="body-sm" role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-destructive">
                {errorCopy.title}
                {errorCopy.description ? ` — ${errorCopy.description}` : ""}
              </Typography>
            )}
            <ServiceRequestForm
              provider={provider}
              requesterName={requesterName}
              onCancel={() => handleOpenChange(false)}
              onSubmit={handleSubmit}
              submitting={submit.pending}
              fieldErrors={fieldErrorMap}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { RequestServiceDialog }
