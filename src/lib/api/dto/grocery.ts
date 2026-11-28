/**
 * The customer Grocery API's wire shapes, exactly as the backend serves them
 * (`docs/backend/API_CONTRACT.md` §18 and §19.8; `backend/app/schemas/grocery.py`). A field the server
 * leaves out is absent (not `null`).
 *
 * There is deliberately no staff field here: a customer response carries no staff name, note, reason,
 * substitution declaration or audit record.
 */

export type GroceryStatusDto = "submitted" | "confirmed" | "preparing" | "out_for_delivery" | "delivered" | "cancelled"
export type GroceryUnitDto = "kg" | "gram" | "litre" | "ml" | "piece" | "pack" | "dozen"
export type GrocerySubstitutionDto = "allow" | "ask" | "none"
export type GroceryUnavailableReasonDto = "disabled" | "no_service_area" | "closed" | "daily_limit_reached"
export type GroceryConfirmationMethodDto = "phone_call" | "in_person" | "written_message"
/** Cash is always offered; a Super Admin switches the others on. */
export type GroceryPaymentMethodDto = "cash_on_delivery" | "card" | "bank_transfer" | "easypaisa" | "jazzcash"
/** One word for an order's money (§21). Absent: nothing is owed or held. */
export type GroceryPaymentStatusDto = "unpaid" | "paid" | "refunded"

export interface GroceryUnitRuleDto {
  unit: GroceryUnitDto
  /** Exact decimal strings. */
  minimum: string
  maximum: string
  step: string
}

export interface GroceryScheduleDto {
  timezone: string
  /** ISO weekdays, 1 = Monday. */
  operatingDays: number[]
  /** Orders are accepted from `opensAt` (included) until `closesAt` (excluded), "HH:MM". */
  opensAt: string
  closesAt: string
}

export interface GroceryAvailabilityDto {
  acceptingOrders: boolean
  unavailableReason?: GroceryUnavailableReasonDto
  serviceableBlocks: string[]
  /** A Super Admin confirmed the blocks cover all of B-17. Absent from a server before §21. */
  coversAllB17?: boolean
  /** The methods a customer may be offered. Absent from a server before §21 (cash only). */
  paymentMethods?: GroceryPaymentMethodDto[]
  schedule: GroceryScheduleDto
  limits: { maxItemsPerOrder: number; maxActiveOrders: number }
  units: GroceryUnitRuleDto[]
  substitutionOptions: GrocerySubstitutionDto[]
}

export interface GroceryItemInputDto {
  name: string
  unit: GroceryUnitDto
  /** A decimal STRING, never a JSON number. */
  quantity: string
  preferredBrand?: string
  substitution: GrocerySubstitutionDto
  note?: string
}

export interface GroceryDeliveryDto {
  contactName: string
  contactPhone: string
  block: string
  addressLine: string
  landmark?: string
}

/** The body of `POST /grocery/orders`. Any other key is refused (`422 not_allowed`). */
export interface GroceryOrderCreateDto {
  items: GroceryItemInputDto[]
  delivery: GroceryDeliveryDto
  instructions?: string
}

export interface GroceryItemDto extends GroceryItemInputDto {
  position: number
}

export interface GroceryOrderSummaryDto {
  id: string
  reference: string
  status: GroceryStatusDto
  revision: number
  itemCount: number
  block: string
  submittedAt: string
  cancelledAt?: string
  /** Present once the team has recorded an agreement. */
  finalAmountDuePaisa?: number
  deliveredAt?: string
  paymentStatus?: GroceryPaymentStatusDto
}

/** A total the TEAM recorded after speaking with the customer. Not an approval given in the app. */
export interface GroceryAgreementDto {
  sequence: number
  itemsSubtotalPaisa: number
  serviceFeePaisa: number
  deliveryFeePaisa: number
  totalPaisa: number
  method: GroceryConfirmationMethodDto
  recordedBy: "staff"
  recordedAt: string
}

/** No staff name, transaction reference or refund reason is ever sent to a customer. */
export interface GroceryPaymentDto {
  /** How it was paid. While `due` it is the default and says nothing about how it will be paid. */
  method: GroceryPaymentMethodDto
  /** `collected`: staff received or verified the money. `refunded`: its return was recorded. */
  status: "due" | "collected" | "refunded"
  amountDuePaisa: number
  amountCollectedPaisa?: number
  collectedAt?: string
  refundedAmountPaisa?: number
  refundedAt?: string
}

export interface GroceryHistoryDto {
  fromStatus?: GroceryStatusDto
  toStatus: GroceryStatusDto
  actorRole: "customer" | "staff"
  /** The customer's own reason only; a staff reason is never sent. */
  reason?: string
  createdAt: string
}

export interface GroceryOrderDetailDto extends GroceryOrderSummaryDto {
  items: GroceryItemDto[]
  delivery: GroceryDeliveryDto
  instructions?: string
  cancelReason?: string
  cancelledBy?: "customer" | "staff"
  agreedTotalPaisa?: number
  agreements: GroceryAgreementDto[]
  payment?: GroceryPaymentDto
  canCancel: boolean
  history: GroceryHistoryDto[]
  updatedAt: string
}
