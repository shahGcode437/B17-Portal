import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, CheckCircle2, ClipboardList, MapPin, CalendarDays, Wrench, ShieldCheck } from "lucide-react"
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
import { useAuth } from "@/hooks/useAuth"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { useMutation } from "@/hooks/useMutation"
import { createRequest } from "@/lib/api/writes/requests"
import { friendlyFieldErrors, userMessageFor } from "@/lib/api/writeErrors"
import { isApiError } from "@/lib/api/errors"
import { routes } from "@/config/routes"

interface RequestServiceDialogProps {
  provider: Provider
  requesterName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })

/**
 * In-page Request Service flow (Phase 12H; VR4 visuals). Submits to `POST /requests`
 * (API_CONTRACT §10.8). The backend derives the provider from the listing's owner, enforces
 * eligibility (approved provider listing, not the requester's own), and rate-limits. No local request
 * record is created — the server is the source of truth. On success the dialog shows the real
 * backend-returned record and offers "View in My Requests". No contact-channel outcome is promised.
 */
function RequestServiceDialog({ provider, requesterName, open, onOpenChange }: RequestServiceDialogProps) {
  const { user } = useAuth()
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
        setFieldErrorMap(friendlyFieldErrors(error))
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
  // The API refuses a request from an unverified account (`403 email_not_verified`); say so up front rather than after
  // the form is filled in. Only a session that is KNOWN to be unverified: anything else gets the form, and the API
  // stays the authority.
  const needsVerification = !!user && !user.emailVerified

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {needsVerification ? (
          <>
            <DialogHeader>
              <Stack direction="row" align="center" gap={3}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-warning/15 text-warning-text">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                </span>
                <Stack gap={1} className="min-w-0">
                  <DialogTitle>Verify your email first</DialogTitle>
                  <DialogDescription>
                    Verifying your email address is required before you can send a service request to {provider.name}.
                  </DialogDescription>
                </Stack>
              </Stack>
            </DialogHeader>
            <VerificationNotice />
            <Button variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
              Not now
            </Button>
          </>
        ) : submittedValues ? (
          <Stack gap={6} className="text-left">
            <Stack direction="row" align="center" gap={3}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success-text ring-1 ring-success/30">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <Stack gap={1}>
                <DialogTitle className="text-xl">Request sent</DialogTitle>
                <DialogDescription>
                  Your request is created inside B-17 Portal. Follow its status in My Requests.
                </DialogDescription>
              </Stack>
            </Stack>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ConfirmTile icon={Wrench} label="Provider" value={provider.name} />
              <ConfirmTile icon={ClipboardList} label="Service" value={submittedValues.service} capitalize />
              <ConfirmTile
                icon={CalendarDays}
                label="Preferred date"
                value={dateFormatter.format(new Date(submittedValues.preferredDate))}
              />
              <ConfirmTile icon={MapPin} label="Area" value={submittedValues.area} />
            </dl>
            <Typography variant="caption" className="text-muted-foreground">
              The current status is <span className="font-medium text-foreground">Submitted</span>. B-17 Portal doesn't
              send e-mail, SMS or WhatsApp notifications yet — check back in My Requests for updates.
            </Typography>
            <Stack direction="row" wrap gap={2} className="justify-end">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button asChild onClick={() => handleOpenChange(false)}>
                <Link to={routes.profileRequests}>
                  View in My Requests
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </Stack>
          </Stack>
        ) : (
          <>
            <DialogHeader>
              <Stack direction="row" align="center" gap={3}>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
                  <ClipboardList className="size-5" aria-hidden="true" />
                </span>
                <Stack gap={1} className="min-w-0">
                  <DialogTitle>Request {provider.name}</DialogTitle>
                  <DialogDescription>
                    Share a few details and the provider will see your request. You can follow its progress in My
                    Requests; B-17 Portal does not pass on your phone or WhatsApp number.
                  </DialogDescription>
                </Stack>
              </Stack>
            </DialogHeader>
            {errorCopy && (
              <Typography
                variant="body-sm"
                role="alert"
                className="rounded-xl bg-destructive/10 px-3.5 py-2.5 font-medium text-destructive ring-1 ring-destructive/20"
              >
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

interface ConfirmTileProps {
  icon: typeof Wrench
  label: string
  value: string
  capitalize?: boolean
}

function ConfirmTile({ icon: Icon, label, value, capitalize }: ConfirmTileProps) {
  return (
    <div className="min-w-0 rounded-xl bg-secondary/60 p-3">
      <Typography as="dt" variant="caption" className="flex items-center gap-1.5 font-medium">
        <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        {label}
      </Typography>
      <Typography as="dd" variant="body-sm" className={`mt-0.5 break-words font-semibold${capitalize ? " capitalize" : ""}`}>
        {value}
      </Typography>
    </div>
  )
}

export { RequestServiceDialog }
