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
  GroceryStatusDto,
} from "@/lib/api/dto/grocery"

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
  paymentCollected: boolean
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
  method: "cash_on_delivery"
  amountDuePaisa: number
  amountCollectedPaisa: number
  collectedBy: GroceryStaffMemberDto
  collectedAt: string
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
  amountCollectedPaisa: number
}

export interface GroceryStaffCancelBodyDto extends GroceryRevisionBodyDto {
  reason: string
  procurementAcknowledged?: boolean
}

export interface GroceryIssueBodyDto {
  kind: GroceryRecordableIssueDto
  note: string
}
