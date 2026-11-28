import type { GroceryConfirmationMethodDto, GrocerySubstitutionDto } from "@/lib/api/dto/grocery"
import type {
  GroceryIssueKindDto,
  GroceryRecordableIssueDto,
  GroceryRefundMethodDto,
  GroceryStaffActionDto,
  GroceryStaffMemberDto,
  GroceryStaffOrderDetailDto,
} from "@/lib/api/dto/groceryStaff"

/** Words for the staff screens. They describe what STAFF record; none claims a customer's own action in the app. */

export const METHOD_OPTIONS: { value: GroceryConfirmationMethodDto; label: string }[] = [
  { value: "phone_call", label: "Phone call" },
  { value: "in_person", label: "In person" },
  { value: "written_message", label: "Written message" },
]

export const METHOD_NAME: Record<GroceryConfirmationMethodDto, string> = {
  phone_call: "Phone call",
  in_person: "In person",
  written_message: "Written message",
}

/** The customer's preference for one item, as staff read it. */
export const ITEM_SUBSTITUTION: Record<GrocerySubstitutionDto, string> = {
  allow: "A similar substitute is fine",
  ask: "Ask the customer before substituting",
  none: "No substitutes",
}

export const ISSUE_LABEL: Record<GroceryIssueKindDto, string> = {
  customer_unreachable: "Customer unreachable",
  item_shortage: "Item shortage",
  delivery_problem: "Delivery problem",
  payment_discrepancy: "Payment discrepancy",
  other: "Other",
  cancelled_after_procurement: "Cancelled after buying may have started",
}

/** How a refund went back, as staff read and choose it. */
export const REFUND_METHOD_NAME: Record<GroceryRefundMethodDto, string> = {
  cash: "in cash",
  card: "to the card",
  bank_transfer: "by bank transfer",
  easypaisa: "with Easypaisa",
  jazzcash: "with JazzCash",
}

export const RECORDABLE_ISSUES: GroceryRecordableIssueDto[] = [
  "customer_unreachable",
  "item_shortage",
  "delivery_problem",
  "payment_discrepancy",
  "other",
]

/** What an action is called in a message about whether it was saved. */
export const ACTION_NOUN: Record<GroceryStaffActionDto, string> = {
  claim: "your claim",
  release: "the release",
  confirm: "the agreement",
  reconfirm: "the new agreement",
  reduce_amount: "the lower amount",
  start_preparing: "the start of preparation",
  dispatch: "the dispatch",
  delivery_failed: "the failed delivery",
  complete: "the delivery and cash",
  cancel: "the cancellation",
  record_payment: "the payment",
  record_refund: "the refund",
  record_issue: "the issue",
}

/** The toast after the server has said yes. */
export const ACTION_DONE: Record<GroceryStaffActionDto, string> = {
  claim: "You claimed this order.",
  release: "You released this order.",
  confirm: "Agreement recorded. The order is confirmed.",
  reconfirm: "New agreement recorded.",
  reduce_amount: "The amount due was lowered.",
  start_preparing: "The order is being prepared.",
  dispatch: "The order is out for delivery.",
  delivery_failed: "Failed delivery recorded. The order is back in preparing.",
  complete: "Delivery and cash recorded.",
  cancel: "The order was cancelled.",
  record_payment: "Payment recorded. The order's status didn't change.",
  record_refund: "Refund recorded.",
  record_issue: "Issue recorded.",
}

/** A paid order is delivered without collecting anything, so no cash is spoken of. */
export function actionNoun(action: GroceryStaffActionDto, before: GroceryStaffOrderDetailDto): string {
  return action === "complete" && before.payment ? "the delivery" : ACTION_NOUN[action]
}

export function actionDone(action: GroceryStaffActionDto, before: GroceryStaffOrderDetailDto): string {
  return action === "complete" && before.payment ? "Delivery recorded." : ACTION_DONE[action]
}

export function memberName(member: GroceryStaffMemberDto | undefined, viewerId: string): string {
  if (!member) return "A staff member"
  if (member.userId === viewerId) return "You"
  return member.displayName || "A staff member"
}

export function assignmentLabel(assignee: GroceryStaffMemberDto | undefined, viewerId: string): string {
  if (!assignee) return "Unassigned"
  if (assignee.userId === viewerId) return "Assigned to you"
  return `Assigned to ${assignee.displayName || "another staff member"}`
}

/**
 * Why some actions are not on offer. What IS offered comes from the server's `availableActions`;
 * these sentences only explain the rules behind it.
 */
export function actionNotes(order: GroceryStaffOrderDetailDto, viewerId: string, superAdmin: boolean): string[] {
  if (order.status === "delivered" || order.status === "cancelled") {
    const finished = ["This order is finished. You can still record an issue."]
    if (order.availableActions.includes("record_refund")) {
      finished.push("If its payment has been returned to the customer, record the refund.")
    }
    return finished
  }
  const holder = order.assignee
  const mine = holder?.userId === viewerId
  const notes: string[] = []
  if (!superAdmin) {
    if (!holder) return ["Claim this order to work on it. You can record an issue without claiming it."]
    if (!mine) {
      return [
        `${holder.displayName || "Another staff member"} has this order. Only they or a Super Admin can work on it. You can still record an issue.`,
      ]
    }
  } else if (holder && !mine) {
    notes.push(`${holder.displayName || "Another staff member"} has this order. As Super Admin you can still act on it.`)
  }
  if (order.payment && !order.refund) {
    notes.push(
      superAdmin
        ? "This order is paid: its amount can't be changed. To cancel it, return the money first, then record the refund."
        : "This order is paid: its amount can't be changed. Only a Super Admin can record a refund and cancel it. If it can't be supplied, record an issue."
    )
    if (order.status === "out_for_delivery") notes.push("To refund it, first record this delivery as failed.")
    return notes
  }
  if (order.status === "preparing" && !superAdmin) {
    notes.push("Only a Super Admin can cancel once preparation has started. If it needs cancelling, record an issue.")
  }
  if (order.status === "out_for_delivery") {
    notes.push("To cancel, first record this delivery as failed.")
  }
  return notes
}
