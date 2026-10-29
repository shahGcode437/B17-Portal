import { Link } from "react-router-dom"
import { TriangleAlert } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"

interface ListingLimitNoticeProps {
  used: number
  max: number
  /** Where the notice sits: the create flow links to the owner's listings; the listings page IS that page. */
  where: "listings" | "create"
  id?: string
  className?: string
}

/**
 * "You are at your plan's active-listing limit" (Phase 12S Step A). It only warns: nothing is disabled,
 * because the server owns the limit and the count shown here can be stale. There is no upgrade action -
 * no billing exists, so the one thing a person can do today is archive an active listing.
 */
function ListingLimitNotice({ used, max, where, id, className }: ListingLimitNoticeProps) {
  return (
    <div
      id={id}
      role="status"
      className={cn("flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-left", className)}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
      <Stack gap={1} className="min-w-0">
        <Typography as="h2" variant="label" className="text-warning-text">
          Active listing limit reached
        </Typography>
        <Typography variant="body-sm">
          You have {used} of {max} active listings, the most your current plan allows. Archive an active listing before
          creating another.
        </Typography>
        {where === "create" && (
          <>
            {/* The listings page already explains what counts in its usage card, right below this notice. */}
            <Typography variant="caption" className="text-muted-foreground">
              Pending and approved listings count; rejected and archived ones don't.
            </Typography>
            <Link
              to={routes.providerListings}
              className="mt-1 inline-flex min-h-11 w-fit items-center rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Manage my listings
            </Link>
          </>
        )}
      </Stack>
    </div>
  )
}

export { ListingLimitNotice }
