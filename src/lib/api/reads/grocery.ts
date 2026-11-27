import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import type {
  GroceryAvailabilityDto,
  GroceryOrderDetailDto,
  GroceryOrderSummaryDto,
  GroceryStatusDto,
} from "@/lib/api/dto/grocery"

/** `GET /grocery/availability` — public, nothing personal. A hint: submission decides again. */
export function fetchGroceryAvailability(signal?: AbortSignal): Promise<GroceryAvailabilityDto> {
  return apiRequest<GroceryAvailabilityDto>("GET", "/grocery/availability", { signal })
}

export interface GroceryOrderListParams {
  status?: GroceryStatusDto
  limit?: number
  offset?: number
}

/** `GET /grocery/orders` — the signed-in customer's own orders, newest first. */
export function fetchMyGroceryOrders(
  params: GroceryOrderListParams = {},
  signal?: AbortSignal
): Promise<Page<GroceryOrderSummaryDto>> {
  return apiRequestPage<GroceryOrderSummaryDto>("GET", `/grocery/orders${queryString({ ...params })}`, {
    signal,
    session: true,
  })
}

/** `GET /grocery/orders/{id}` — the owner only; anyone else's order is the same `404`. */
export function fetchMyGroceryOrder(id: string, signal?: AbortSignal): Promise<GroceryOrderDetailDto> {
  return apiRequest<GroceryOrderDetailDto>("GET", `/grocery/orders/${segment(id)}`, { signal, session: true })
}
