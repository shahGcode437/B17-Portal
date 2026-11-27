import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { FormAlert } from "@/components/forms/FormAlert"
import { EmptyState } from "@/components/feedback/EmptyState"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { CancelOrderDialog } from "@/features/grocery/CancelOrderDialog"
import { GroceryTimeline } from "@/features/grocery/GroceryTimeline"
import { ItemDetails } from "@/features/grocery/ItemRow"
import { OrderStatusBadge } from "@/features/grocery/OrderStatusBadge"
import { PriceCard } from "@/features/grocery/PriceCard"
import { STATUS_META, failedDeliveries, isFinal } from "@/features/grocery/orderStatus"
import { formatClock, formatStamp } from "@/features/grocery/format"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { useToast } from "@/hooks/useToast"
import { fetchMyGroceryOrder } from "@/lib/api/reads/grocery"
import { userMessageFor } from "@/lib/api/writeErrors"
import { isResourceNotFound, type ApiError } from "@/lib/api/errors"
import { routes } from "@/config/routes"
import { formatPhone } from "@/lib/phone"
import { cn } from "@/lib/utils"
import type { GroceryOrderDetailDto } from "@/lib/api/dto/grocery"

/** Coming back to the tab checks again, but not more often than this. */
const RECHECK_AFTER_MS = 15_000

const CHECKED = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** What the status means now, including a delivery that did not complete and who cancelled. */
function StatusSummary({ order }: { order: GroceryOrderDetailDto }) {
  const attempts = failedDeliveries(order)
  const retrying = attempts > 0 && order.status === "preparing"
  return (
    <div className="flex flex-col gap-3">
      <Typography variant="body">{STATUS_META[order.status].summary}</Typography>
      {retrying && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-warning/10 p-3 ring-1 ring-warning/35">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
          <Typography variant="body-sm">
            <span className="font-semibold">A delivery attempt didn't complete.</span> Your order is back in preparing and
            hasn't been delivered. Our team contacts you directly about the next attempt.
          </Typography>
        </div>
      )}
      {order.status === "cancelled" && (
        <Typography variant="body-sm" className="text-muted-foreground">
          {order.cancelledBy === "customer"
            ? `You cancelled it${order.cancelledAt ? ` on ${formatStamp(order.cancelledAt)}` : ""}.`
            : "Our team cancelled it. We tell customers about a cancellation directly."}
          {order.cancelReason && ` Your reason: ${order.cancelReason}`}
        </Typography>
      )}
      {!order.canCancel && !isFinal(order.status) && (
        <Typography variant="body-sm" className="text-muted-foreground">
          This order can no longer be cancelled here. If you need a change, tell our team when they contact you.
        </Typography>
      )}
    </div>
  )
}

function OrderView({ userId, orderId }: { userId: string; orderId: string }) {
  const navigate = useNavigate()
  const { show } = useToast()
  const read = useRefreshableRead(`grocery-order:${userId}:${orderId}`, (signal) => fetchMyGroceryOrder(orderId, signal))
  const [cancelling, setCancelling] = useState(false)
  const [stale, setStale] = useState<ApiError | null>(null)
  const order = read.data
  const final = order ? isFinal(order.status) : false

  // Coming back to the tab (or back online) looks again. No polling: this is not live tracking.
  const lastCheck = useRef(0)
  const { refresh, receivedAt } = read
  useEffect(() => {
    lastCheck.current = receivedAt ?? lastCheck.current
  }, [receivedAt])
  useEffect(() => {
    if (final) return
    const recheck = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastCheck.current < RECHECK_AFTER_MS) return
      lastCheck.current = Date.now()
      refresh()
    }
    window.addEventListener("focus", recheck)
    window.addEventListener("online", recheck)
    document.addEventListener("visibilitychange", recheck)
    return () => {
      window.removeEventListener("focus", recheck)
      window.removeEventListener("online", recheck)
      document.removeEventListener("visibilitychange", recheck)
    }
  }, [final, refresh])

  if (!order) {
    if (read.loading) {
      return (
        <div role="status" aria-label="Loading your order" className="flex flex-col gap-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )
    }
    if (read.error && isResourceNotFound(read.error)) {
      return (
        <EmptyState
          headingLevel={1}
          title="Order not found"
          description="It doesn't exist, or it belongs to another account."
          actionLabel="My Grocery Orders"
          onAction={() => navigate(routes.profileGrocery)}
        />
      )
    }
    return read.error ? <ReadError error={read.error} onRetry={read.refresh} headingLevel={1} title="Couldn't load your order" /> : null
  }

  const checked = read.receivedAt ? formatClock(CHECKED.format(new Date(read.receivedAt))) : null
  const staleCopy = stale ? userMessageFor(stale, "grocery-cancel") : null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Typography variant="h1" className="text-2xl sm:text-3xl">
            Order {order.reference}
          </Typography>
          <OrderStatusBadge status={order.status} />
        </div>
        <Typography variant="body-sm" className="text-muted-foreground">
          Sent {formatStamp(order.submittedAt)}
        </Typography>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="h-11" onClick={read.refresh} disabled={read.refreshing}>
            <RefreshCw className={cn(read.refreshing && "animate-spin")} />
            {read.refreshing ? "Checking…" : "Refresh status"}
          </Button>
          <Typography variant="body-sm" role="status" className="text-muted-foreground">
            {checked ? `Last checked ${checked} (Pakistan time). Updates appear when you refresh.` : ""}
          </Typography>
        </div>
      </header>

      {read.error && (
        <FormAlert
          tone="warning"
          title="Couldn't refresh"
          description="You're seeing the last version we received. Try again."
        />
      )}
      {staleCopy && (
        <AttentionRegion signal={stale}>
          <FormAlert tone="warning" title={staleCopy.title} description={staleCopy.description} />
        </AttentionRegion>
      )}

      <section aria-label="Current status" className="glass-panel flex flex-col gap-5 rounded-2xl p-4 sm:p-5">
        <StatusSummary order={order} />
        <GroceryTimeline order={order} />
        {order.canCancel && (
          <Button type="button" variant="destructive" className="h-11 self-start" onClick={() => setCancelling(true)}>
            Cancel order
          </Button>
        )}
      </section>

      <PriceCard order={order} />

      <section aria-labelledby="grocery-items" className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
        <Typography as="h2" id="grocery-items" variant="h3" className="text-lg">
          {order.items.length === 1 ? "1 item requested" : `${order.items.length} items requested`}
        </Typography>
        <ol className="flex flex-col divide-y divide-border">
          {order.items.map((item) => (
            <li key={item.position} className="flex py-2.5 first:pt-0 last:pb-0">
              <ItemDetails {...item} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="grocery-delivery" className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
        <Typography as="h2" id="grocery-delivery" variant="h3" className="text-lg">
          Delivery details
        </Typography>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="break-words">{order.delivery.contactName}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>{formatPhone(order.delivery.contactPhone)}</dd>
          <dt className="text-muted-foreground">Block</dt>
          <dd>{order.delivery.block}</dd>
          <dt className="text-muted-foreground">Address</dt>
          <dd className="break-words">{order.delivery.addressLine}</dd>
          {order.delivery.landmark && (
            <>
              <dt className="text-muted-foreground">Landmark</dt>
              <dd className="break-words">{order.delivery.landmark}</dd>
            </>
          )}
          {order.instructions && (
            <>
              <dt className="text-muted-foreground">Instructions</dt>
              <dd className="whitespace-pre-line break-words">{order.instructions}</dd>
            </>
          )}
        </dl>
      </section>

      <CancelOrderDialog
        order={order}
        open={cancelling}
        onOpenChange={setCancelling}
        onCancelled={(updated) => {
          setStale(null)
          read.replace(updated)
          show("Your order was cancelled.")
        }}
        onStale={(error) => {
          setStale(error)
          read.refresh()
        }}
      />
    </div>
  )
}

/** One of the customer's own orders (GROCERY-3A): status, price, cash, items and delivery. */
function GroceryOrderPage() {
  const { orderId = "" } = useParams()
  const user = useRequireAuth()
  if (!user) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Link to={routes.profileGrocery} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" />
          My Grocery Orders
        </Link>
        {user.emailVerified ? (
          // Keyed by account and order, so nothing of another's is ever shown.
          <OrderView key={`${user.id}:${orderId}`} userId={user.id} orderId={orderId} />
        ) : (
          <>
            <Typography variant="h1">Grocery order</Typography>
            <VerificationNotice />
          </>
        )}
      </div>
    </Container>
  )
}

export { GroceryOrderPage }
