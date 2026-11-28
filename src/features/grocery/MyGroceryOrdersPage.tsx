import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "motion/react"
import { ChevronRight, Plus, RefreshCw, ShoppingBasket } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/workspace/PageHeader"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { OrderStatusBadge } from "@/features/grocery/OrderStatusBadge"
import { SentNotice } from "@/features/grocery/GroceryNotices"
import { ALL_STATUSES, STATUS_META } from "@/features/grocery/orderStatus"
import { formatDay, formatPaisa } from "@/features/grocery/format"
import { usePagedRead } from "@/hooks/usePagedRead"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { fetchMyGroceryOrders } from "@/lib/api/reads/grocery"
import { groceryOrderPath, routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { GroceryOrderSummaryDto, GroceryStatusDto } from "@/lib/api/dto/grocery"

const PAGE = 10

/**
 * The money line of a summary, from what the summary carries. It never says "paid": that comes from
 * the payment record, which only the order's own page has.
 */
function amountLine(order: GroceryOrderSummaryDto): string | null {
  if (order.status === "cancelled") return null
  if (order.finalAmountDuePaisa === undefined) return "Price to be confirmed"
  if (order.status === "delivered") return `Total ${formatPaisa(order.finalAmountDuePaisa)}`
  return `${formatPaisa(order.finalAmountDuePaisa)} to pay in cash`
}

/** One order in the history: no name, phone or address (the summary carries none that we show). */
function OrderCard({ order }: { order: GroceryOrderSummaryDto }) {
  const amount = amountLine(order)
  return (
    <Link
      to={groceryOrderPath(order.id)}
      className="glass-panel flex items-center gap-3 rounded-2xl p-4 transition-shadow hover:shadow-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-base font-semibold tracking-wide">{order.reference}</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <Typography as="span" variant="body-sm" className="text-muted-foreground">
          Sent {formatDay(order.submittedAt)} · {order.itemCount === 1 ? "1 item" : `${order.itemCount} items`}
        </Typography>
        {amount && (
          <Typography as="span" variant="body-sm" className="font-medium">
            {amount}
          </Typography>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function StatusFilter({ value, onChange }: { value: GroceryStatusDto | null; onChange: (status: GroceryStatusDto | null) => void }) {
  const options: { key: GroceryStatusDto | null; label: string }[] = [
    { key: null, label: "All" },
    ...ALL_STATUSES.map((status) => ({ key: status, label: STATUS_META[status].label })),
  ]
  return (
    <div role="group" aria-label="Filter by status" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            "h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            value === option.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card/70 text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function OrderHistory({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const requested = params.get("status")
  const status = ALL_STATUSES.find((candidate) => candidate === requested) ?? null
  const orders = usePagedRead(`grocery-orders:${userId}:${status ?? "all"}`, async (offset, signal) => {
    const page = await fetchMyGroceryOrders({ status: status ?? undefined, limit: PAGE, offset }, signal)
    return { items: page.items, raw: page.items.length, total: page.meta.total, extra: undefined }
  })

  return (
    <div className="flex flex-col gap-4">
      <StatusFilter
        value={status}
        onChange={(next) => setParams(next ? { status: next } : {}, { replace: true })}
      />
      <div className="flex items-center justify-between gap-3">
        <Typography variant="body-sm" role="status" className="text-muted-foreground">
          {orders.loading || orders.error ? "" : orders.total === 1 ? "1 order" : `${orders.total} orders`}
        </Typography>
        {/* Beside the list rather than in the page header, where on a phone it squeezed the title. */}
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" className="h-11" onClick={orders.retry} disabled={orders.loading}>
            <RefreshCw className={cn(orders.loading && "animate-spin")} />
            Refresh
          </Button>
          <Button asChild className="h-11">
            <Link to={routes.grocery}>
              <Plus />
              New order
            </Link>
          </Button>
        </div>
      </div>

      {orders.loading ? (
        <div role="status" aria-label="Loading your grocery orders" className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : orders.error ? (
        <ReadError error={orders.error} onRetry={orders.retry} title="Couldn't load your grocery orders" />
      ) : orders.items.length === 0 && status ? (
        <EmptyState
          icon={ShoppingBasket}
          title={`No ${STATUS_META[status].label.toLowerCase()} orders`}
          description="Orders with another status aren't shown while this filter is on."
          actionLabel="Show all orders"
          onAction={() => setParams({}, { replace: true })}
        />
      ) : orders.items.length === 0 ? (
        <EmptyState
          icon={ShoppingBasket}
          title="No grocery orders yet"
          description="Orders you send will appear here, with their status and price."
          actionLabel="Go to Grocery"
          onAction={() => navigate(routes.grocery)}
        />
      ) : (
        <>
          <motion.ul initial="initial" animate="animate" variants={staggerContainer} aria-label="Your grocery orders" className="flex flex-col gap-3">
            {orders.items.map((order) => (
              <motion.li key={order.id} variants={staggerItem}>
                <OrderCard order={order} />
              </motion.li>
            ))}
          </motion.ul>
          {orders.hasMore && (
            <Stack align="center" gap={2}>
              <Button variant="outline" className="h-11" onClick={orders.loadMore} disabled={orders.loadingMore}>
                {orders.loadingMore ? "Loading…" : "Load More"}
              </Button>
              {orders.moreError && (
                <Typography variant="body-sm" role="alert" className="text-destructive">
                  Couldn't load more. Try again.
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}
    </div>
  )
}

/** My Grocery Orders (GROCERY-3A): the signed-in customer's own orders, from the server only. */
function MyGroceryOrdersPage() {
  const user = useRequireAuth()
  if (!user) return null
  return (
    <Container className="py-8 sm:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader
          icon={ShoppingBasket}
          eyebrow="Account"
          title="My Grocery Orders"
          description="What you've sent, where each order stands and what it costs."
          meta={<ResidentNav />}
        />
        <SentNotice />
        {user.emailVerified ? (
          // Keyed by account, so one person's list can never be shown to the next.
          <OrderHistory key={user.id} userId={user.id} />
        ) : (
          <VerificationNotice />
        )}
      </div>
    </Container>
  )
}

export { MyGroceryOrdersPage }
