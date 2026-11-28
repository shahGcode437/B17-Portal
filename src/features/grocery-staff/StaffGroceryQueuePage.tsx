import { useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ClipboardCheck, Settings2, ShoppingBasket } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { RefreshBar } from "@/components/workspace/RefreshBar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadError } from "@/components/feedback/ReadError"
import { PageHeader } from "@/components/workspace/PageHeader"
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceEmpty"
import { STATUS_META } from "@/features/grocery/orderStatus"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { StaffQueueFilters } from "@/features/grocery-staff/StaffQueueFilters"
import { StaffQueueRow } from "@/features/grocery-staff/StaffQueueRow"
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  filterSearch,
  queueParams,
  readFilters,
  type QueueFilters,
} from "@/features/grocery-staff/queueFilters"
import { mustForget } from "@/features/grocery-staff/staffErrors"
import { useReportLostAccess, useStaffReload } from "@/features/grocery-staff/useStaffSession"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { fetchGroceryQueue, type GroceryQueuePage } from "@/lib/api/reads/groceryStaff"
import { routes } from "@/config/routes"
import { isSuperAdmin } from "@/lib/staffAccess"
import type { GroceryStatusDto } from "@/lib/api/dto/grocery"
import type { CurrentUser } from "@/types/auth"

const OPEN: GroceryStatusDto[] = ["submitted", "confirmed", "preparing", "out_for_delivery"]

interface AttentionCardProps {
  title: string
  assigned: "me" | "unassigned"
  data: GroceryQueuePage | undefined
  failed: boolean
  nothing: string
}

/** Open orders from the server's own counts, each figure a link to exactly those orders. */
function AttentionCard({ title, assigned, data, failed, nothing }: AttentionCardProps) {
  const present = data ? OPEN.filter((status) => (data.counts[status] ?? 0) > 0) : []
  const total = data ? present.reduce((sum, status) => sum + (data.counts[status] ?? 0), 0) : undefined
  return (
    <div className="glass-panel flex min-w-0 flex-col gap-2 rounded-2xl p-4">
      <Typography as="h3" variant="label" className="flex justify-between gap-3 text-base">
        <span>{title}</span>
        <span className="tabular-nums">{total ?? "—"}</span>
      </Typography>
      {!data ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          {failed ? "Couldn't load this count." : "Loading…"}
        </Typography>
      ) : present.length === 0 ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          {nothing}
        </Typography>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {present.map((status) => (
            <li key={status}>
              <Link
                to={`${routes.adminGrocery}${filterSearch({ ...DEFAULT_FILTERS, status, assigned })}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card/70 px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {STATUS_META[status].label}
                <span className="font-semibold tabular-nums">{data.counts[status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Queue({ user }: { user: CurrentUser }) {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const search = filterSearch(filters)
  const options = { forgetOn: mustForget }
  const queue = useRefreshableRead(
    `staff-grocery-queue:${user.id}:${search}`,
    (signal) => fetchGroceryQueue(queueParams(filters), signal),
    options
  )
  const unclaimed = useRefreshableRead(
    `staff-grocery-unclaimed:${user.id}`,
    (signal) => fetchGroceryQueue({ assigned: "unassigned", limit: 1 }, signal),
    options
  )
  const mine = useRefreshableRead(
    `staff-grocery-mine:${user.id}`,
    (signal) => fetchGroceryQueue({ assigned: "me", limit: 1 }, signal),
    options
  )
  useReportLostAccess(queue.error)

  const { refresh: refreshQueue } = queue
  const { refresh: refreshUnclaimed } = unclaimed
  const { refresh: refreshMine } = mine
  const reload = useStaffReload(
    user,
    useCallback(() => {
      refreshQueue()
      refreshUnclaimed()
      refreshMine()
    }, [refreshQueue, refreshUnclaimed, refreshMine])
  )

  const apply = (next: QueueFilters) => setParams(new URLSearchParams(filterSearch(next)), { replace: true })
  // Any change of filter starts again at the first page.
  const change = (patch: Partial<QueueFilters>) => apply({ ...filters, page: 1, ...patch })

  const data = queue.data
  const colleague = data?.items.find((order) => order.assignee?.userId === filters.assigned)?.assignee?.displayName
  const first = (filters.page - 1) * PAGE_SIZE + 1
  const last = data ? first + data.items.length - 1 : 0
  const unfiltered = search === ""

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ShoppingBasket}
        eyebrow="Staff"
        title="Grocery orders"
        description="Claim an order, call the customer, record what they agree to, then buy, deliver and collect the cash. Your own orders are never listed here."
        meta={
          <div className="flex flex-col gap-3">
            {isSuperAdmin(user) && (
              <Button asChild variant="outline" className="h-11 self-start">
                <Link to={routes.adminGrocerySettings}>
                  <Settings2 aria-hidden="true" />
                  Grocery settings
                </Link>
              </Button>
            )}
            <RefreshBar
              receivedAt={queue.receivedAt}
              refreshing={queue.refreshing}
              failed={Boolean(queue.error && data)}
              onRefresh={() => void reload()}
            />
          </div>
        }
      />

      <section aria-labelledby="staff-attention" className="flex flex-col gap-3">
        <Typography as="h2" id="staff-attention" variant="h3" className="text-lg">
          Open orders
        </Typography>
        <div className="grid gap-3 sm:grid-cols-2">
          <AttentionCard
            title="Nobody has claimed"
            assigned="unassigned"
            data={unclaimed.data}
            failed={Boolean(unclaimed.error)}
            nothing="No open order is waiting to be claimed."
          />
          <AttentionCard
            title="Assigned to you"
            assigned="me"
            data={mine.data}
            failed={Boolean(mine.error)}
            nothing="You have no open order."
          />
        </div>
      </section>

      <section aria-labelledby="staff-queue" className="flex flex-col gap-3">
        <Typography as="h2" id="staff-queue" variant="h3" className="text-lg">
          Queue
        </Typography>
        <StaffQueueFilters
          filters={filters}
          counts={data?.counts}
          colleague={colleague}
          onChange={change}
          onClear={() => apply(DEFAULT_FILTERS)}
        />

        {!data ? (
          queue.error ? (
            <ReadError error={queue.error} onRetry={() => void reload()} headingLevel={3} title="Couldn't load the queue" />
          ) : (
            <div role="status" aria-label="Loading the grocery queue" className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-2xl" />
              ))}
            </div>
          )
        ) : data.items.length === 0 ? (
          data.total > 0 ? (
            <WorkspaceEmpty
              icon={ClipboardCheck}
              message="There are no orders on this page any more."
              action={{ label: "Go to the first page", onClick: () => apply({ ...filters, page: 1 }) }}
            />
          ) : (
            <WorkspaceEmpty
              icon={ClipboardCheck}
              message={unfiltered ? "No new orders are waiting." : "No orders match these filters."}
              action={unfiltered ? undefined : { label: "Show new orders", onClick: () => apply(DEFAULT_FILTERS) }}
            />
          )
        ) : (
          <>
            <ul aria-label="Orders" className="flex flex-col gap-2">
              {data.items.map((order) => (
                <li key={order.id}>
                  <StaffQueueRow order={order} viewerId={user.id} queue={search} />
                </li>
              ))}
            </ul>
            <nav aria-label="Queue pages" className="flex flex-wrap items-center justify-between gap-3">
              <Typography variant="body-sm" role="status" className="text-muted-foreground">
                Showing {first}–{last} of {data.total}
              </Typography>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={filters.page === 1}
                  onClick={() => apply({ ...filters, page: filters.page - 1 })}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={last >= data.total}
                  onClick={() => apply({ ...filters, page: filters.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  )
}

/** The grocery staff workspace: what is open, and the queue (GROCERY-3B). */
function StaffGroceryQueuePage() {
  const user = useRequireAuth()
  if (!user) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Queue key={user.id} user={user} />
      </div>
    </Container>
  )
}

export { StaffGroceryQueuePage }
