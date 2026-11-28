import { Link } from "react-router-dom"
import { Banknote, ChevronRight, Flag, PackageX, Undo2, UserRound, UserRoundCheck } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { OrderStatusBadge } from "@/features/grocery/OrderStatusBadge"
import { formatPaisa, formatStamp } from "@/features/grocery/format"
import { assignmentLabel } from "@/features/grocery-staff/staffLabels"
import { adminGroceryOrderPath } from "@/config/routes"
import { cn } from "@/lib/utils"
import type { GroceryStaffOrderSummaryDto } from "@/lib/api/dto/groceryStaff"

function Flagged({ icon: Icon, children }: { icon: typeof Flag; children: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-warning-text">
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  )
}

/** One order in the queue. The server sends no name, phone, address or item text here, and none is shown. */
function StaffQueueRow({ order, viewerId, queue }: { order: GroceryStaffOrderSummaryDto; viewerId: string; queue: string }) {
  const due = order.finalAmountDuePaisa
  const mine = order.assignee?.userId === viewerId
  const refunded = order.paymentStatus === "refunded"
  const money = refunded ? "refunded" : order.paymentCollected ? "paid" : order.status === "cancelled" ? "on record" : "due"
  return (
    <Link
      to={adminGroceryOrderPath(order.id)}
      state={{ queue }}
      className="glass-panel flex min-w-0 items-center gap-3 rounded-2xl p-4 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Typography as="span" variant="label" className="text-base">
            {order.reference}
          </Typography>
          <OrderStatusBadge status={order.status} />
        </span>
        <Typography as="span" variant="body-sm" className="text-muted-foreground">
          Sent {formatStamp(order.submittedAt)}
        </Typography>
        <Typography as="span" variant="body-sm" className="break-words">
          {order.block} · {order.itemCount === 1 ? "1 item" : `${order.itemCount} items`} ·{" "}
          {due === undefined ? "No price yet" : `${formatPaisa(due)} ${money}`}
        </Typography>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={cn("inline-flex items-center gap-1", mine ? "font-semibold text-primary" : "text-muted-foreground")}>
            {order.assignee ? <UserRoundCheck className="size-3.5" aria-hidden="true" /> : <UserRound className="size-3.5" aria-hidden="true" />}
            {assignmentLabel(order.assignee, viewerId)}
          </span>
          {order.paymentCollected && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Banknote className="size-3.5" aria-hidden="true" />
              Paid
            </span>
          )}
          {refunded && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Undo2 className="size-3.5" aria-hidden="true" />
              Refunded
            </span>
          )}
          {order.failedDeliveryAttempts > 0 && (
            <Flagged icon={PackageX}>
              {order.failedDeliveryAttempts === 1 ? "1 failed delivery" : `${order.failedDeliveryAttempts} failed deliveries`}
            </Flagged>
          )}
          {order.issueCount > 0 && <Flagged icon={Flag}>{order.issueCount === 1 ? "1 issue" : `${order.issueCount} issues`}</Flagged>}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

export { StaffQueueRow }
