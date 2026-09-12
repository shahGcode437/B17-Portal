import { useState } from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import type { PendingListing } from "@/types/listing"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { useListingsStore } from "@/state/listingsStore"
import { useToast } from "@/hooks/useToast"

interface ReviewPanelProps {
  listing: PendingListing | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_REASON_LENGTH = 10

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

/**
 * Approve/reject moderation dialog (Master Spec §17), mirroring the
 * RequestServiceDialog pattern: a single Dialog whose body swaps views
 * (preview+actions vs. reject-reason) via local state.
 */
function ReviewPanel({ listing, open, onOpenChange }: ReviewPanelProps) {
  const { setStatus } = useListingsStore()
  const { show } = useToast()
  const [showReasonInput, setShowReasonInput] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      // Reset after the close animation so the dialog doesn't flash empty while closing.
      setTimeout(() => {
        setShowReasonInput(false)
        setReason("")
        setReasonError(null)
      }, 200)
    }
  }

  if (!listing) return null

  const displayName = listing.kind === "property" ? listing.data.title : listing.data.name

  function handleApprove() {
    if (!listing) return
    setStatus(listing.id, "approved")
    show(`${displayName} approved (demo)`)
    handleOpenChange(false)
  }

  function handleConfirmReject() {
    if (!listing) return
    const trimmed = reason.trim()
    if (trimmed.length < MIN_REASON_LENGTH) {
      setReasonError(`Please provide a specific reason (at least ${MIN_REASON_LENGTH} characters).`)
      return
    }
    setStatus(listing.id, "rejected", trimmed)
    show(`${displayName} rejected (demo)`)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review Listing</DialogTitle>
          <DialogDescription>
            This is how the listing will appear to residents once approved.
          </DialogDescription>
        </DialogHeader>

        <Stack gap={4}>
          {listing.kind === "provider" && <ProviderCard provider={listing.data} />}
          {listing.kind === "business" && <BusinessCard business={listing.data} />}
          {listing.kind === "property" && <PropertyCard property={listing.data} />}

          <Stack gap={1} className="rounded-lg bg-muted p-3">
            <Typography variant="body-sm">
              <span className="text-muted-foreground">Submitted by:</span>{" "}
              <span className="font-medium">{listing.submittedBy}</span>
            </Typography>
            <Typography variant="body-sm">
              <span className="text-muted-foreground">Submitted:</span>{" "}
              <span className="font-medium">
                {dateFormatter.format(new Date(listing.submittedAt))}
              </span>
            </Typography>
          </Stack>

          {showReasonInput ? (
            <Stack gap={2}>
              <Label htmlFor="reject-reason">Rejection reason</Label>
              <Textarea
                id="reject-reason"
                placeholder="Explain what needs to change before this listing can be approved…"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  if (reasonError) setReasonError(null)
                }}
                aria-invalid={!!reasonError}
                aria-describedby={reasonError ? "reject-reason-error" : undefined}
                autoFocus
              />
              {reasonError && (
                <Typography
                  id="reject-reason-error"
                  variant="caption"
                  className="text-destructive"
                  role="alert"
                >
                  {reasonError}
                </Typography>
              )}
              <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setShowReasonInput(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={handleConfirmReject}>
                  <XCircle />
                  Confirm Rejection
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
              <Button type="button" variant="destructive" onClick={() => setShowReasonInput(true)}>
                <XCircle />
                Reject
              </Button>
              <Button type="button" onClick={handleApprove}>
                <CheckCircle2 />
                Approve
              </Button>
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export { ReviewPanel }
