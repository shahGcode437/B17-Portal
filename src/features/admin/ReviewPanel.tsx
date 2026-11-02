import { useRef, useState } from "react"
import { CheckCircle2, XCircle } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { rowActionClass as actionClass } from "@/features/admin/adminStyles"
import { FoodListingSummary } from "@/features/provider/FoodListingSummary"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { TAKEN_DOWN_LABEL } from "@/features/provider/listingStatusLabel"
import { OwnerListingFacts, OwnerTagList } from "@/features/provider/OwnerListingFacts"
import { OwnerLocationFacts } from "@/features/provider/OwnerLocationFacts"
import { useAdminListing } from "@/hooks/useWorkspaceReads"
import { useMutation } from "@/hooks/useMutation"
import { useToast } from "@/hooks/useToast"
import { approveListing, rejectListing } from "@/lib/api/writes/admin"
import { copyAsSentence, userMessageFor, isConflict } from "@/lib/api/writeErrors"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { AdminHistoryView, AdminQueueRow } from "@/types/ownerListing"

interface ReviewPanelProps {
  /** The queue row that was opened (its fields show at once); the dialog then reads the full review view. */
  row: AdminQueueRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful approve / reject so the queue + counts refresh. */
  onChanged?: () => void
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})
const stampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

/** A rejection of a listing that was live is a TAKEDOWN; every other action is shown under its own name. */
function historyLabel(entry: AdminHistoryView): string {
  return entry.action === "rejected" && entry.fromStatus === "approved" ? TAKEN_DOWN_LABEL : entry.action
}

/**
 * The review dialog for one listing (Master Spec §17), READ-ONLY in Phase 12G. It reads
 * `GET /admin/listings/{id}`: the full review shape, including the PRIVATE location the owner entered
 * (visible only here, to an admin), the submitter's display name, the current revision, the last
 * rejection reason and the status history.
 *
 * Approve and Reject are shown but disabled, with the reason: they are connected to
 * `POST /admin/listings/{id}/approve|reject` in Phase 12H. The old local buttons changed a browser-only
 * copy and reported success, which is exactly what must not happen against real moderation data.
 */
function ReviewPanel({ row, open, onOpenChange, onChanged }: ReviewPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const read = useAdminListing(open && row ? row.id : null)
  const { show } = useToast()
  const [showRejection, setShowRejection] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)

  const approve = useMutation(async ({ id, revision }: { id: string; revision: number }) => approveListing(id, revision))
  const reject = useMutation(async ({ id, revision, reason: r }: { id: string; revision: number; reason: string }) => rejectListing(id, revision, r))

  // A half-made decision (the open reject form, its text and error, the last attempt's outcome) belongs to ONE opening
  // of the dialog for ONE listing. Opening the dialog - for another listing, or the same one again - starts clean, so
  // rejecting A can never leave A's reason, its open reject form or its error on B. It resets on OPENING, not on
  // closing, so the dialog does not change shape while it fades out. (State adjusted during render, React's pattern
  // for state that must follow a prop; the panel stays mounted between listings, which is why it cannot rely on a
  // fresh mount.)
  const openingFor = open && row ? row.id : null
  const [decisionFor, setDecisionFor] = useState<string | null>(null)
  if (openingFor !== decisionFor) {
    setDecisionFor(openingFor)
    if (openingFor !== null) {
      setShowRejection(false)
      setReason("")
      setReasonError(null)
      approve.reset()
      reject.reset()
    }
  }

  if (!row) return null
  const listing = read.status === "success" ? read.data : null
  const currentRevision = listing?.revision ?? row.revision
  const currentStatus = listing?.status ?? row.status
  const canApprove = currentStatus === "pending"
  const canReject = currentStatus === "pending" || currentStatus === "approved"

  const handleApprove = async () => {
    try {
      await approve.mutate({ id: row.id, revision: currentRevision })
      show("Listing approved")
      onChanged?.()
      onOpenChange(false)
    } catch (error) {
      const copy = userMessageFor(error, "admin-approve")
      show(copyAsSentence(copy), { tone: "error" })
      if (isConflict(error)) read.retry()
    }
  }

  const openReject = () => {
    setShowRejection(true)
    setReason("")
    setReasonError(null)
  }

  const submitReject = async () => {
    const trimmed = reason.trim()
    if (trimmed.length < 10) {
      setReasonError("Please give a reason of at least 10 characters.")
      return
    }
    if (trimmed.length > 500) {
      setReasonError("Please keep the reason under 500 characters.")
      return
    }
    try {
      await reject.mutate({ id: row.id, revision: currentRevision, reason: trimmed })
      show(currentStatus === "approved" ? "Listing taken down" : "Listing rejected")
      onChanged?.()
      onOpenChange(false)
    } catch (error) {
      const copy = userMessageFor(error, "admin-reject")
      show(copyAsSentence(copy), { tone: "error" })
      if (isConflict(error)) read.retry()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        // Start at the top of the dialog (title/summary) rather than on the first tabbable element.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        className="max-h-[90svh] gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <div className="flex flex-col gap-4 p-4">
          <DialogHeader className="pr-8">
            <DialogTitle className="break-words">Review Listing</DialogTitle>
            <DialogDescription>
              {currentStatus === "approved"
                ? "This listing is live. Check the details, or take it down with a reason."
                : "Check the details, then approve or reject the listing."}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl bg-muted/70 p-4 text-sm ring-1 ring-border/60">
            <dt className="text-muted-foreground">Listing</dt>
            <dd className="break-words font-semibold">{row.title}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="break-words">{row.typeLabel}</dd>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="break-words">{row.categoryLabel}</dd>
            <dt className="text-muted-foreground">Submitted by</dt>
            <dd className="break-words font-medium">{row.submitterName ?? "Unknown"}</dd>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="font-medium">{dateFormatter.format(new Date(row.submittedAt))}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <ListingStatusBadge status={listing?.status ?? row.status} takenDown={listing ? listing.takenDown : row.takenDown} />
            </dd>
            <dt className="text-muted-foreground">Revision</dt>
            <dd className="font-medium tabular-nums">{listing?.revision ?? row.revision}</dd>
            {listing?.status === "rejected" && listing.rejectionReason && (
              <>
                <dt className="text-muted-foreground">{listing.takenDown ? "Takedown reason" : "Rejection reason"}</dt>
                <dd className="break-words">{listing.rejectionReason}</dd>
              </>
            )}
          </dl>

          {read.status === "loading" && (
            <div role="status" aria-label="Loading the full listing" className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {read.status === "error" && <ReadError error={read.error} onRetry={read.retry} title="Couldn't load this listing" />}

          {listing && (
            <>
              {listing.description && (
                <Typography variant="body-sm" className="break-words text-muted-foreground">
                  {listing.description}
                </Typography>
              )}
              {/* What the moderator is judging (S5A / B-01): the kind's own facts, its Food block and its tags. */}
              <OwnerListingFacts listing={listing} />
              {listing.food && <FoodListingSummary food={listing.food} listingId={listing.id} name={listing.title} />}
              <OwnerTagList listing={listing} />
              <OwnerLocationFacts location={listing.location} area={listing.area} />
              <section aria-label="History" className="flex flex-col gap-3">
                <Typography as="h3" variant="label" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Moderation history
                </Typography>
                <ol className="relative flex flex-col gap-3 pl-5">
                  <span aria-hidden="true" className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                  {listing.history.map((entry, index) => (
                    <li key={`${entry.action}-${index}`} className="relative flex flex-col gap-0.5 text-sm">
                      <span
                        aria-hidden="true"
                        className="absolute -left-5 top-1.5 size-3 rounded-full bg-primary ring-2 ring-background"
                      />
                      <span className="font-semibold capitalize">{historyLabel(entry)}</span>
                      <span className="text-xs text-muted-foreground">
                        revision {entry.revision} · {entry.actorName} ({entry.actorRole}) ·{" "}
                        {stampFormatter.format(new Date(entry.at))}
                      </span>
                      {entry.reason && (
                        <p className="mt-1 break-words rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm text-muted-foreground">
                          “{entry.reason}”
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-border bg-popover/90 p-4 backdrop-blur-sm">
          {showRejection ? (
            <Stack gap={2}>
              <Label htmlFor="review-reason">
                {currentStatus === "approved" ? "Take down reason" : "Rejection reason"} (10–500 characters)
              </Label>
              <Textarea
                id="review-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={!!reasonError}
                disabled={reject.pending}
              />
              {reasonError && (
                <Typography variant="caption" role="alert" className="text-destructive">
                  {reasonError}
                </Typography>
              )}
              <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className={actionClass} onClick={() => setShowRejection(false)} disabled={reject.pending}>
                  Back
                </Button>
                <Button type="button" variant="destructive" className={actionClass} onClick={submitReject} disabled={reject.pending}>
                  {reject.pending ? "Submitting…" : currentStatus === "approved" ? "Confirm takedown" : "Confirm Rejection"}
                </Button>
              </Stack>
            </Stack>
          ) : (
            <>
              <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  className={actionClass}
                  disabled={!canReject || approve.pending || reject.pending}
                  onClick={openReject}
                >
                  <XCircle />
                  {currentStatus === "approved" ? "Take down" : "Reject"}
                </Button>
                <Button
                  type="button"
                  className={actionClass}
                  disabled={!canApprove || approve.pending || reject.pending}
                  onClick={handleApprove}
                >
                  <CheckCircle2 />
                  {approve.pending ? "Approving…" : "Approve"}
                </Button>
              </Stack>
              {approve.status === "error" && (
                <Typography variant="caption" role="alert" className="mt-2 block text-destructive">
                  {userMessageFor(approve.error, "admin-approve").title}
                </Typography>
              )}
              {reject.status === "error" && (
                <Typography variant="caption" role="alert" className="mt-2 block text-destructive">
                  {userMessageFor(reject.error, "admin-reject").title}
                </Typography>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ReviewPanel }
