import { useNavigate } from "react-router-dom"
import type { PendingListing } from "@/types/listing"
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
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { FoodListingSummary } from "@/features/provider/FoodListingSummary"
import { providerProfilePath, businessProfilePath, propertyDetailsPath } from "@/config/routes"

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

interface ListingPreviewDialogProps {
  listing: PendingListing | null
  onOpenChange: (open: boolean) => void
}

/**
 * Read-only "View" for one of the professional's own listings (Phase 9D).
 * Works for every status: pending/rejected/archived listings aren't
 * publicly resolvable yet, so this is the only way to see how they look;
 * approved listings additionally get a link to their real public page.
 */
function ListingPreviewDialog({ listing, onOpenChange }: ListingPreviewDialogProps) {
  const navigate = useNavigate()

  if (!listing) return null

  const publicPath =
    listing.status === "approved"
      ? listing.kind === "provider"
        ? providerProfilePath(listing.data.id)
        : listing.kind === "business"
          ? businessProfilePath(listing.data.id)
          : propertyDetailsPath(listing.data.id)
      : null

  return (
    <Dialog open={!!listing} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <Stack direction="row" align="start" justify="between" gap={2}>
            <DialogTitle>Listing Preview</DialogTitle>
            <ListingStatusBadge status={listing.status} />
          </Stack>
          <DialogDescription>
            Submitted {dateFormatter.format(new Date(listing.submittedAt))}
          </DialogDescription>
        </DialogHeader>

        {listing.kind === "provider" && <ProviderCard provider={listing.data} />}
        {listing.kind === "business" && <BusinessCard business={listing.data} />}
        {listing.kind === "business" && <FoodListingSummary business={listing.data} />}
        {listing.kind === "property" && <PropertyCard property={listing.data} />}

        {listing.status === "rejected" && listing.rejectionReason && (
          <Typography variant="body-sm" className="text-destructive">
            Reason: {listing.rejectionReason}
          </Typography>
        )}

        {publicPath && (
          <DialogFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false)
                navigate(publicPath)
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
