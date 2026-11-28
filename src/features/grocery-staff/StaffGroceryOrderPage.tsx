import { useCallback, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, UserRoundX } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { RefreshBar } from "@/components/workspace/RefreshBar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { FormAlert } from "@/components/forms/FormAlert"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { OrderStatusBadge } from "@/features/grocery/OrderStatusBadge"
import { formatStamp } from "@/features/grocery/format"
import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { StaffActionForm } from "@/features/grocery-staff/OrderActionForms"
import { StaffActionsPanel } from "@/features/grocery-staff/StaffActionsPanel"
import {
  AgreementsPanel,
  AttemptsPanel,
  CustomerPanel,
  HistoryPanel,
  PaymentPanel,
  RequestPanel,
  StaffLogPanel,
} from "@/features/grocery-staff/StaffOrderRecords"
import { assignmentLabel } from "@/features/grocery-staff/staffLabels"
import { focusActionsIfLost } from "@/features/grocery-staff/fieldFocus"
import { isOwnOrder, mustForget, staffRefusalCopy } from "@/features/grocery-staff/staffErrors"
import { DEFAULT_FILTERS, filterSearch } from "@/features/grocery-staff/queueFilters"
import { useStaffOrderWrite } from "@/features/grocery-staff/useStaffOrderWrite"
import { useReportLostAccess, useStaffReload } from "@/features/grocery-staff/useStaffSession"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { fetchGroceryStaffOrder } from "@/lib/api/reads/groceryStaff"
import { claimGroceryOrder } from "@/lib/api/writes/groceryStaff"
import { isResourceNotFound } from "@/lib/api/errors"
import { groceryOrderPath, routes } from "@/config/routes"
import { isSuperAdmin } from "@/lib/staffAccess"
import type { CurrentUser } from "@/types/auth"
import type { GroceryStaffActionDto } from "@/lib/api/dto/groceryStaff"

function OrderWorkspace({ user, orderId }: { user: CurrentUser; orderId: string }) {
  const navigate = useNavigate()
  const read = useRefreshableRead(
    `staff-grocery-order:${user.id}:${orderId}`,
    (signal) => fetchGroceryStaffOrder(orderId, signal),
    // Lost access, an ended session or a vanished order: nothing already loaded stays on screen.
    { forgetOn: mustForget }
  )
  const order = read.data
  useReportLostAccess(read.error)
  const reload = useStaffReload(user, read.refresh)

  const [dialog, setDialog] = useState<Exclude<GroceryStaffActionDto, "claim"> | null>(null)
  const [claimProblem, setClaimProblem] = useState<ReturnType<typeof staffRefusalCopy> | null>(null)
  const closeDialog = useCallback(() => setDialog(null), [])
  const write = useStaffOrderWrite({
    userId: user.id,
    orderId,
    order,
    replace: read.replace,
    reload: read.refresh,
    closeDialog,
  })
  const { run, pageExplains } = write

  async function onAction(action: GroceryStaffActionDto) {
    setClaimProblem(null)
    if (action !== "claim") {
      setDialog(action)
      return
    }
    const result = await run("claim", (signal) => claimGroceryOrder(orderId, signal))
    if (result && "kept" in result) setClaimProblem(staffRefusalCopy(result.kept))
    else if (result && !pageExplains()) focusActionsIfLost()
  }

  if (!order) {
    if (read.error) {
      if (isOwnOrder(read.error)) {
        return (
          <EmptyState
            icon={UserRoundX}
            headingLevel={1}
            title="This is your own order"
            description="Staff can't view or handle their own orders here; another staff member handles it. You can follow it as a customer."
            actionLabel="View it as a customer"
            onAction={() => navigate(groceryOrderPath(orderId))}
          />
        )
      }
      if (isResourceNotFound(read.error)) {
        return (
          <EmptyState
            headingLevel={1}
            title="Order not found"
            description="There is no grocery order at this address."
            actionLabel="Back to the queue"
            onAction={() => navigate(routes.adminGrocery)}
          />
        )
      }
      return <ReadError error={read.error} onRetry={() => void reload()} headingLevel={1} title="Couldn't load this order" />
    }
    return (
      <div role="status" aria-label="Loading the order" className="flex flex-col gap-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  const notice = write.notice ?? claimProblem

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
          Sent {formatStamp(order.submittedAt)} · {order.block} · {assignmentLabel(order.assignee, user.id)}
        </Typography>
        <RefreshBar
          receivedAt={read.receivedAt}
          refreshing={read.refreshing}
          failed={Boolean(read.error)}
          onRefresh={() => void reload()}
        />
        {order.assignee && order.assignee.userId !== user.id && (
          <Link
            to={`${routes.adminGrocery}${filterSearch({ ...DEFAULT_FILTERS, status: "all", assigned: order.assignee.userId })}`}
            className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary"
          >
            All orders held by {order.assignee.displayName || "this staff member"}
          </Link>
        )}
      </header>

      {notice && (
        <AttentionRegion signal={`${notice.title}|${notice.description}`}>
          <FormAlert
            tone="warning"
            title={notice.title}
            description={notice.description}
            action={
              write.locked && !read.refreshing ? (
                <Button type="button" variant="outline" className="h-11" onClick={() => void reload()}>
                  Load the order again
                </Button>
              ) : undefined
            }
          />
        </AttentionRegion>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="lg:sticky lg:top-20 lg:order-2">
          <StaffActionsPanel
            order={order}
            viewerId={user.id}
            superAdmin={isSuperAdmin(user)}
            pending={write.pending}
            locked={write.locked}
            onAction={(action) => void onAction(action)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <CustomerPanel order={order} />
          <RequestPanel order={order} />
          <PaymentPanel order={order} viewerId={user.id} />
          <AgreementsPanel order={order} viewerId={user.id} />
          <AttemptsPanel order={order} viewerId={user.id} />
          <StaffLogPanel order={order} viewerId={user.id} />
          <HistoryPanel order={order} viewerId={user.id} />
        </div>
      </div>

      {dialog && (
        <StaffActionForm
          key={dialog}
          action={dialog}
          order={order}
          pending={write.pending}
          run={run}
          onClose={closeDialog}
          pageExplains={pageExplains}
        />
      )}
    </div>
  )
}

/** One grocery order on the staff side (GROCERY-3B). Reached only through the grocery-staff gate. */
function StaffGroceryOrderPage() {
  const { orderId = "" } = useParams()
  const user = useRequireAuth()
  const location = useLocation()
  const from = (location.state as { queue?: string } | null)?.queue
  if (!user) return null
  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Link
          // Back to the queue as it was filtered, when we came from it.
          to={from ? `${routes.adminGrocery}${from}` : routes.adminGrocery}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Grocery queue
        </Link>
        {/* Keyed by account and order: nothing typed or loaded for one is ever shown for another. */}
        <OrderWorkspace key={`${user.id}:${orderId}`} user={user} orderId={orderId} />
      </div>
    </Container>
  )
}

export { StaffGroceryOrderPage }
