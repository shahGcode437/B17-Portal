/**
 * The Grocery STAFF API's wire shapes, exactly as the backend serves them
 * (`docs/backend/API_CONTRACT.md` §19; `backend/app/schemas/grocery_staff.py`). A field the server
 * leaves out is absent (not `null`).
 *
 * Kept apart from the customer shapes (`dto/grocery.ts`) on purpose: these carry staff names,
 * internal notes and audit records that no customer screen may ever hold. Only the staff workspace
 * and this API layer import this module (`architecture.test.ts`).
 */
import type {
  GroceryConfirmationMethodDto,
  GroceryDeliveryDto,
  GroceryItemDto,
  GroceryPaymentMethodDto,
  GroceryPaymentStatusDto,
  GroceryStatusDto,
} from "@/lib/api/dto/grocery"

/** Cash is recorded with the delivery; these are recorded once staff have verified the money. */
export type GroceryRecordableMethodDto = Exclude<GroceryPaymentMethodDto, "cash_on_delivery">
/** How a refund went back, outside this application. */
export type GroceryRefundMethodDto = "cash" | "card" | "bank_transfer" | "easypaisa" | "jazzcash"

export type GroceryStaffActionDto =
  | "claim"
  | "release"
  | "confirm"
  | "reconfirm"
  | "reduce_amount"
  | "start_preparing"
  | "dispatch"
  | "delivery_failed"
  | "complete"
  | "cancel"
  | "record_payment"
  | "record_refund"
  | "record_issue"

/** The kinds a person may record. */
export type GroceryRecordableIssueDto =
  | "payment_discrepancy"
  | "item_shortage"
  | "delivery_problem"
  | "customer_unreachable"
  | "other"

/** Including the one the server records by itself. */
export type GroceryIssueKindDto = GroceryRecordableIssueDto | "cancelled_after_procurement"

export type GroceryEventActionDto = "claimed" | "released" | "amount_reduced" | "issue_recorded"

export interface GroceryStaffMemberDto {
  userId: string
  displayName?: string
}

/** A queue row: NO customer name, phone, address or item text. */
export interface GroceryStaffOrderSummaryDto {
  id: string
  reference: string
  status: GroceryStatusDto
  revision: number
  submittedAt: string
  /** `YYYY-MM-DD`, the Pakistan day the order counts against. */
  serviceDate: string
  block: string
  itemCount: number
  assignee?: GroceryStaffMemberDto
  agreedTotalPaisa?: number
  finalAmountDuePaisa?: number
  /** Money is held for the order: paid and not refunded. */
  paymentCollected: boolean
  paymentStatus?: GroceryPaymentStatusDto
  failedDeliveryAttempts: number
  issueCount: number
}

/** A customer agreement as a staff member RECORDED it. Never the customer's own action. */
export interface GroceryStaffConfirmationDto {
  sequence: number
  itemsSubtotalPaisa: number
  serviceFeePaisa: number
  deliveryFeePaisa: number
  totalPaisa: number
  method: GroceryConfirmationMethodDto
  substitutionsAgreed: boolean
  pricingNote?: string
  consentNote?: string
  recordedBy: GroceryStaffMemberDto
  recordedAt: string
}

export interface GroceryStaffPaymentDto {
  method: GroceryPaymentMethodDto
  amountDuePaisa: number
  amountCollectedPaisa: number
  /** The external transaction reference (never a card or account number). Absent for cash. */
  reference?: string
  /** Who collected the cash or verified the payment. */
  collectedBy: GroceryStaffMemberDto
  collectedAt: string
}

/** A Super Admin's record that the whole payment was returned outside the application. */
export interface GroceryStaffRefundDto {
  amountPaisa: number
  method: GroceryRefundMethodDto
  reference?: string
  reason: string
  refundedBy: GroceryStaffMemberDto
  refundedAt: string
}

export interface GroceryDeliveryAttemptDto {
  attempt: number
  dispatchedBy: GroceryStaffMemberDto
  dispatchedAt: string
  note?: string
  outcome: "in_progress" | "failed" | "delivered"
  outcomeBy?: GroceryStaffMemberDto
  outcomeAt?: string
  failureReason?: string
}

export interface GroceryStaffHistoryDto {
  fromStatus?: GroceryStatusDto
  toStatus: GroceryStatusDto
  actorRole: "customer" | "staff"
  /** Absent for the customer's own rows. */
  actor?: GroceryStaffMemberDto
  reason?: string
  createdAt: string
}

export interface GroceryStaffEventDto {
  action: GroceryEventActionDto
  actor: GroceryStaffMemberDto
  subject?: GroceryStaffMemberDto
  amountBeforePaisa?: number
  amountAfterPaisa?: number
  issueKind?: GroceryIssueKindDto
  note?: string
  createdAt: string
}

export interface GroceryStaffOrderDetailDto extends GroceryStaffOrderSummaryDto {
  items: GroceryItemDto[]
  delivery: GroceryDeliveryDto
  instructions?: string
  cancelledAt?: string
  deliveredAt?: string
  confirmations: GroceryStaffConfirmationDto[]
  payment?: GroceryStaffPaymentDto
  refund?: GroceryStaffRefundDto
  /** The non-cash methods switched on now. Empty once paid; absent from a server before §21. */
  recordableMethods?: GroceryRecordableMethodDto[]
  deliveryAttempts: GroceryDeliveryAttemptDto[]
  history: GroceryStaffHistoryDto[]
  events: GroceryStaffEventDto[]
  /** A hint for what to offer; the server decides again on every request. */
  availableActions: GroceryStaffActionDto[]
  updatedAt: string
}

// ------------------------------------------------------------------------------ request bodies
// Strict on the server: any other key is `422 not_allowed`. Money is a whole number of paisa.

export interface GroceryRevisionBodyDto {
  revision: number
}

export interface GroceryAgreementBodyDto extends GroceryRevisionBodyDto {
  itemsSubtotalPaisa: number
  serviceFeePaisa: number
  deliveryFeePaisa: number
  agreedTotalPaisa: number
  customerAgreed: true
  method: GroceryConfirmationMethodDto
  substitutionsAgreed: boolean
  pricingNote?: string
  consentNote?: string
}

/** A new agreement must say what the customer newly agreed to. */
export interface GroceryReagreementBodyDto extends GroceryAgreementBodyDto {
  consentNote: string
}

export interface GroceryReduceAmountBodyDto extends GroceryRevisionBodyDto {
  finalAmountPaisa: number
  reason: string
}

export interface GroceryDispatchBodyDto extends GroceryRevisionBodyDto {
  note?: string
}

export interface GroceryDeliveryFailedBodyDto extends GroceryRevisionBodyDto {
  reason: string
}

export interface GroceryCompleteBodyDto extends GroceryRevisionBodyDto {
  /** The cash received for an unpaid order. Left out for one already paid. */
  amountCollectedPaisa?: number
}

export interface GroceryRecordPaymentBodyDto extends GroceryRevisionBodyDto {
  method: GroceryRecordableMethodDto
  amountPaisa: number
  reference: string
  moneyVerified: true
}

export interface GroceryRefundBodyDto extends GroceryRevisionBodyDto {
  amountPaisa: number
  method: GroceryRefundMethodDto
  /** Required unless returned in cash. */
  reference?: string
  reason: string
  moneyReturned: true
  /** Required when this cancels an order that is being prepared. */
  procurementAcknowledged?: boolean
}

export interface GroceryStaffCancelBodyDto extends GroceryRevisionBodyDto {
  reason: string
  procurementAcknowledged?: boolean
}

export interface GroceryIssueBodyDto {
  kind: GroceryRecordableIssueDto
  note: string
}
