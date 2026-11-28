import { CheckCircle2, ClipboardCheck, PackageCheck, Send, Truck, XCircle, type LucideIcon } from "lucide-react"
import type { StatusTone } from "@/components/feedback/StatusBadge"
import type { GroceryOrderDetailDto, GroceryStatusDto } from "@/lib/api/dto/grocery"

/** How each of the six statuses reads to the CUSTOMER. Nothing here claims live tracking. */
export const STATUS_META: Record<GroceryStatusDto, { label: string; tone: StatusTone; icon: LucideIcon; summary: string }> = {
  submitted: {
    label: "Submitted",
    tone: "info",
    icon: Send,
    summary: "We have your list. Our team will confirm availability and the total price with you before preparing it.",
  },
  confirmed: {
    label: "Confirmed",
    tone: "success",
    icon: ClipboardCheck,
    summary: "Our team has recorded the total price for your order. Preparation hasn't started yet.",
  },
  preparing: {
    label: "Preparing",
    tone: "warning",
    icon: PackageCheck,
    summary: "Your order is being prepared.",
  },
  out_for_delivery: {
    label: "Out for delivery",
    tone: "warning",
    icon: Truck,
    summary: "Your order is on its way.",
  },
  delivered: { label: "Delivered", tone: "success", icon: CheckCircle2, summary: "Your order was delivered." },
  cancelled: { label: "Cancelled", tone: "danger", icon: XCircle, summary: "This order was cancelled." },
}

export const ALL_STATUSES = Object.keys(STATUS_META) as GroceryStatusDto[]

export const ORDER_STEPS: GroceryStatusDto[] = ["submitted", "confirmed", "preparing", "out_for_delivery", "delivered"]

/** A finished order never changes status again, so there is nothing to look for. */
export function isFinal(status: GroceryStatusDto): boolean {
  return status === "delivered" || status === "cancelled"
}

export interface TimelineStep {
  status: GroceryStatusDto
  state: "done" | "current" | "upcoming"
  /** When the order (last) entered this status; never given for a step that is still ahead. */
  at?: string
}

type Lifecycle = Pick<GroceryOrderDetailDto, "status" | "history">

function lastEntry(order: Lifecycle, status: GroceryStatusDto): string | undefined {
  return [...order.history].reverse().find((row) => row.toStatus === status)?.createdAt
}

/**
 * The status timeline, from the order's CURRENT status and the server's history. An order that went
 * out and came back to `preparing` shows `preparing` as current and "out for delivery" as still ahead
 * (the earlier attempt is explained separately), so nothing looks further along than it is. A
 * cancelled order shows only the steps it really reached, then the cancellation.
 */
export function timelineOf(order: Lifecycle): TimelineStep[] {
  if (order.status === "cancelled") {
    const cancellation = [...order.history].reverse().find((row) => row.toStatus === "cancelled")
    const from = ORDER_STEPS.indexOf(cancellation?.fromStatus ?? "submitted")
    const reached: TimelineStep[] = ORDER_STEPS.slice(0, Math.max(from, 0) + 1).map((status) => ({
      status,
      state: "done",
      at: lastEntry(order, status),
    }))
    return [...reached, { status: "cancelled", state: "current", at: cancellation?.createdAt }]
  }
  const current = ORDER_STEPS.indexOf(order.status)
  return ORDER_STEPS.map((status, index) => {
    if (index > current) return { status, state: "upcoming" }
    return { status, state: index < current ? "done" : "current", at: lastEntry(order, status) }
  })
}

/** How many delivery attempts did not complete: each move from "out for delivery" back to "preparing". */
export function failedDeliveries(order: Lifecycle): number {
  return order.history.filter((row) => row.fromStatus === "out_for_delivery" && row.toStatus === "preparing").length
}
