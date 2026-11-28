import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type {
  GroceryAgreementBodyDto,
  GroceryCompleteBodyDto,
  GroceryDeliveryFailedBodyDto,
  GroceryDispatchBodyDto,
  GroceryIssueBodyDto,
  GroceryReagreementBodyDto,
  GroceryRecordPaymentBodyDto,
  GroceryRefundBodyDto,
  GroceryReduceAmountBodyDto,
  GroceryRevisionBodyDto,
  GroceryStaffCancelBodyDto,
  GroceryStaffOrderDetailDto,
} from "@/lib/api/dto/groceryStaff"

/**
 * The thirteen staff changes (`docs/backend/API_CONTRACT.md` §19, §21). Each is sent ONCE: nothing here, and
 * nothing in the client (which never sends any request twice), sends it again. Every one answers
 * with the order as it now is.
 */
function change(id: string, operation: string, signal: AbortSignal | undefined, body?: object): Promise<GroceryStaffOrderDetailDto> {
  return apiRequest<GroceryStaffOrderDetailDto>("POST", `/admin/grocery/orders/${segment(id)}/${operation}`, {
    session: true,
    ...(body ? { body } : {}),
    signal,
  })
}

export const claimGroceryOrder = (id: string, signal?: AbortSignal) => change(id, "claim", signal)

export const releaseGroceryOrder = (id: string, signal?: AbortSignal) => change(id, "release", signal)

export const confirmGroceryOrder = (id: string, body: GroceryAgreementBodyDto, signal?: AbortSignal) =>
  change(id, "confirm", signal, body)

export const reconfirmGroceryOrder = (id: string, body: GroceryReagreementBodyDto, signal?: AbortSignal) =>
  change(id, "reconfirm", signal, body)

export const reduceGroceryAmount = (id: string, body: GroceryReduceAmountBodyDto, signal?: AbortSignal) =>
  change(id, "reduce-amount", signal, body)

export const startPreparingGroceryOrder = (id: string, body: GroceryRevisionBodyDto, signal?: AbortSignal) =>
  change(id, "start-preparing", signal, body)

export const dispatchGroceryOrder = (id: string, body: GroceryDispatchBodyDto, signal?: AbortSignal) =>
  change(id, "dispatch", signal, body)

export const recordFailedGroceryDelivery = (id: string, body: GroceryDeliveryFailedBodyDto, signal?: AbortSignal) =>
  change(id, "delivery-failed", signal, body)

export const completeGroceryOrder = (id: string, body: GroceryCompleteBodyDto, signal?: AbortSignal) =>
  change(id, "complete", signal, body)

export const cancelGroceryOrderAsStaff = (id: string, body: GroceryStaffCancelBodyDto, signal?: AbortSignal) =>
  change(id, "cancel", signal, body)

export const recordGroceryPayment = (id: string, body: GroceryRecordPaymentBodyDto, signal?: AbortSignal) =>
  change(id, "record-payment", signal, body)

export const recordGroceryRefund = (id: string, body: GroceryRefundBodyDto, signal?: AbortSignal) =>
  change(id, "refund", signal, body)

export const recordGroceryIssue = (id: string, body: GroceryIssueBodyDto, signal?: AbortSignal) =>
  change(id, "issues", signal, body)
