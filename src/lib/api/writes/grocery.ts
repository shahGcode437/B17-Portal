import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type { GroceryOrderCreateDto, GroceryOrderDetailDto } from "@/lib/api/dto/grocery"

/**
 * `POST /grocery/orders`. `idempotencyKey` is REQUIRED by the API: the same key with the same order
 * answers with the order it already created (`200`), so a retry can never create a second one.
 * The caller owns the key (see `features/grocery/groceryDraftStore`).
 */
export function submitGroceryOrder(
  payload: GroceryOrderCreateDto,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<GroceryOrderDetailDto> {
  return apiRequest<GroceryOrderDetailDto>("POST", "/grocery/orders", {
    session: true,
    body: payload,
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
  })
}

/** `POST /grocery/orders/{id}/cancel` — the revision the customer was looking at, and an optional reason. */
export function cancelGroceryOrder(id: string, revision: number, reason?: string): Promise<GroceryOrderDetailDto> {
  return apiRequest<GroceryOrderDetailDto>("POST", `/grocery/orders/${segment(id)}/cancel`, {
    session: true,
    body: reason ? { revision, reason } : { revision },
  })
}
