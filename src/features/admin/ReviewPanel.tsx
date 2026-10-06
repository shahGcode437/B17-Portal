import { useRef, useState } from "react"
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
import { rowActionClass as actionClass } from "@/features/admin/adminStyles"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { FoodListingSummary } from "@/features/provider/FoodListingSummary"
import { businessTypeLabel } from "@/features/provider/listingDisplay"
import { useListingsStore } from "@/state/listingsStore"
import { useToast } from "@/hooks/useToast"

interface ReviewPanelProps {
  listing: PendingListing | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_REASON_LENGTH = 10

const kindLabel: Record<PendingListing["kind"], string> = {
  provider: "Service / Professional",
  business: "Business / Shop",
  property: "Property",
}

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
  const contentRef = useRef<HTMLDivElement>(null)

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
      <DialogContent
        ref={contentRef}
        // Start at the top of the dialog (title/summary) rather than on the first tabbable element,
        // which would be the resident preview card — the decision controls come after reading.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        className="gap-0 p-0 sm:max-w-md"
      >
        <div className="flex flex-col gap-4 p-4">
          <DialogHeader className="pr-8">
            <DialogTitle className="break-words">Review Listing</DialogTitle>
            <DialogDescription>
              Check the details, then approve or reject. The preview below is how it will appear to residents once approved.
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-muted p-3 text-sm">
            <dt className="text-muted-foreground">Listing</dt>
            <dd className="break-words font-medium">{displayName}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="break-words">
              {listing.kind === "business" ? businessTypeLabel(listing.data, kindLabel.business) : kindLabel[listing.kind]}
            </dd>
            <dt className="text-muted-foreground">Submitted by</dt>
            <dd className="break-words font-medium">{listing.submittedBy}</dd>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="font-medium">{dateFormatter.format(new Date(listing.submittedAt))}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <ListingStatusBadge status={listing.status} />
            </dd>
            {listing.status === "rejected" && listing.rejectionReason && (
              <>
                <dt className="text-muted-foreground">Rejection reason</dt>
                <dd className="break-words">{listing.rejectionReason}</dd>
              </>
            )}
          </dl>

          {listing.kind === "business" && <FoodListingSummary business={listing.data} />}

          <section aria-label="Resident preview" className="flex flex-col gap-2">
            <Typography as="h3" variant="label" className="text-muted-foreground">
              Resident preview
            </Typography>
            {listing.kind === "provider" && <ProviderCard provider={listing.data} />}
            {listing.kind === "business" && <BusinessCard business={listing.data} />}
            {listing.kind === "property" && <PropertyCard property={listing.data} />}
          </section>
        </div>

        <div className="sticky bottom-0 border-t border-border bg-popover p-4">
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
                aria-describedby={reasonError ? "reject-reason-hint reject-reason-error" : "reject-reason-hint"}
                rows={3}
                className="min-h-24 text-base md:text-sm"
                autoFocus
              />
              <Typography id="reject-reason-hint" variant="caption">
                At least {MIN_REASON_LENGTH} characters. The submitter will see this reason on their listing.
              </Typography>
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
                <Button type="button" variant="outline" className={actionClass} onClick={() => setShowReasonInput(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" className={actionClass} onClick={handleConfirmReject}>
                  <XCircle />
                  Confirm Rejection
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
              <Button type="button" variant="destructive" className={actionClass} onClick={() => setShowReasonInput(true)}>
                <XCircle />
                Reject
              </Button>
              <Button type="button" className={actionClass} onClick={handleApprove}>
                <CheckCircle2 />
                Approve
              </Button>
            </Stack>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ReviewPanel }
