import { useNavigate } from "react-router-dom"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ReadError } from "@/components/feedback/ReadError"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { OwnerLocationFacts } from "@/features/provider/OwnerLocationFacts"
import { useOwnerListing } from "@/hooks/useWorkspaceReads"
import { foodCategoryLabel, foodServiceLabel } from "@/config/food"
import type { OwnerListingView } from "@/types/ownerListing"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

interface ListingPreviewDialogProps {
  /** The row that was opened (its fields show at once); the dialog then reads the listing afresh. */
  listing: OwnerListingView | null
  onOpenChange: (open: boolean) => void
}

/**
 * Read-only "View" for one of the professional's own listings. It reads `GET /users/me/listings/{id}`
 * when it opens, so what it shows - status, revision, the admin's reason for a rejection, and the
 * location AS THE OWNER ENTERED IT - is the server's current truth, not a copy that may have gone
 * stale. Approved listings additionally link to their real public page.
 */
function ListingPreviewDialog({ listing, onOpenChange }: ListingPreviewDialogProps) {
  const navigate = useNavigate()
  const read = useOwnerListing(listing?.id ?? null)
  if (!listing) return null
  const current = read.status === "success" ? read.data : listing

  return (
    <Dialog open={!!listing} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <Stack direction="row" align="start" justify="between" gap={2}>
            <DialogTitle className="min-w-0 break-words">{current.title}</DialogTitle>
            <ListingStatusBadge status={current.status} />
          </Stack>
          <DialogDescription>
            {current.typeLabel} · {current.categoryLabel}
          </DialogDescription>
        </DialogHeader>

        <Stack gap={4} className="text-left">
          <Typography variant="caption" className="text-muted-foreground">
            Submitted {dateFormatter.format(new Date(current.submittedAt))} · revision {current.revision}
          </Typography>

          {current.status === "rejected" && current.rejectionReason && (
            <Typography variant="body-sm" className="rounded-lg bg-destructive/5 px-3 py-2 text-destructive">
              <span className="font-medium">Reason:</span> {current.rejectionReason}
            </Typography>
          )}

          {current.description && (
            <Typography variant="body-sm" className="break-words text-muted-foreground">
              {current.description}
            </Typography>
          )}

          {read.status === "loading" && (
            <div role="status" aria-label="Loading listing" className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {read.status === "error" && <ReadError error={read.error} onRetry={read.retry} title="Couldn't load this listing" />}
          {read.status === "success" && (
            <>
              <OwnerLocationFacts location={read.data.location} area={read.data.area} />
              {read.data.food && (
                <section aria-label="Food and dining" className="flex flex-col gap-2">
                  <Typography as="h3" variant="label" className="text-xs">
                    Food & Dining
                  </Typography>
                  <Typography variant="body-sm">{read.data.food.categories.map(foodCategoryLabel).join(", ")}</Typography>
                  <Stack direction="row" wrap gap={2}>
                    {read.data.food.serviceOptions.map((option) => (
                      <Badge key={option} variant="outline" className="font-normal">
                        {foodServiceLabel(option)}
                      </Badge>
                    ))}
                  </Stack>
                  {read.data.food.hoursNote && (
                    <Typography variant="body-sm" className="text-muted-foreground">
                      {read.data.food.hoursNote}
                    </Typography>
                  )}
                </section>
              )}
              {read.data.tags.length > 0 && (
                <Stack direction="row" wrap gap={2}>
                  {read.data.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </Stack>
              )}
            </>
          )}
        </Stack>

        {current.publicPath && (
          <DialogFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false)
                navigate(current.publicPath ?? "")
              }}
            >
              View Public Listing
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { ListingPreviewDialog }
