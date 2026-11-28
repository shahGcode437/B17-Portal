import { Link } from "react-router-dom"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { formatStamp } from "@/features/grocery/format"
import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import type { SubmissionMarker } from "@/features/grocery/submissionMarker"
import { useUncheckedSubmission } from "@/features/grocery/useUncheckedSubmission"
import { useRead } from "@/hooks/useRead"
import { fetchMyGroceryOrders } from "@/lib/api/reads/grocery"
import { groceryOrderPath, routes } from "@/config/routes"

/** The browser's clock and the server's need not agree exactly. */
const CLOCK_ALLOWANCE_MS = 2 * 60 * 1000
const linkClass = "inline-flex min-h-11 items-center px-1 font-medium text-primary underline underline-offset-4"

function Check({ marker, viewerId }: { marker: SubmissionMarker; viewerId: string }) {
  const dismiss = useGroceryDraft((draft) => draft.dismissRecovery)
  // The customer's own orders, newest first, read as this account (GROCERY-4A binds the read).
  const read = useRead(`grocery-recovery:${viewerId}:${marker.sentAt}`, (signal) => fetchMyGroceryOrders({ limit: 5 }, signal))
  const found =
    read.status === "success"
      ? read.data.items.find((order) => Date.parse(order.submittedAt) >= marker.sentAt - CLOCK_ALLOWANCE_MS)
      : undefined

  return (
    <section
      aria-labelledby="grocery-recovery"
      className="flex flex-col gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/40 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <Typography as="h2" id="grocery-recovery" variant="label" className="text-base font-semibold">
            Check your last order before sending another
          </Typography>
          <Typography variant="body-sm">
            An order was being sent from this tab ({formatStamp(new Date(marker.sentAt).toISOString())}) when the page
            reloaded, before we heard back.
          </Typography>
          <div role="status">
            <Typography variant="body-sm" className="font-medium">
              {read.status === "loading"
                ? "Checking your orders…"
                : read.status === "error"
                  ? "We couldn't check your orders just now."
                  : found
                    ? `We found an order received around then: ${found.reference}. If that's it, don't send it again.`
                    : "We don't see it in your orders yet, so it may not have reached us."}
            </Typography>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {read.status === "success" ? (
          <Button type="button" className="h-11" onClick={dismiss}>
            I've checked my orders
          </Button>
        ) : null}
        {read.status !== "loading" && !found && (
          <Button type="button" variant="outline" className="h-11" onClick={read.retry}>
            <RefreshCw />
            Check my orders again
          </Button>
        )}
        {found && (
          <Link to={groceryOrderPath(found.id)} className={linkClass}>
            See order {found.reference}
          </Link>
        )}
        <Link to={routes.profileGrocery} className={linkClass}>
          My Grocery Orders
        </Link>
      </div>
    </section>
  )
}

/**
 * After a reload in the middle of sending (GROCERY-4B): nothing is resent; the customer is shown
 * their own recent orders and decides. Shown only to the account that was sending.
 */
function RecoveryNotice() {
  const unchecked = useUncheckedSubmission()
  return unchecked ? <Check marker={unchecked.marker} viewerId={unchecked.viewerId} /> : null
}

export { RecoveryNotice }
