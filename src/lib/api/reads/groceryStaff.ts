import { apiRequest, apiRequestPage } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import { ApiError } from "@/lib/api/errors"
import type { GroceryStaffOrderDetailDto, GroceryStaffOrderSummaryDto } from "@/lib/api/dto/groceryStaff"
import type { GroceryStatusDto } from "@/lib/api/dto/grocery"

export interface GroceryQueueParams {
  status?: GroceryStatusDto
  /** A reference or its beginning (3 to 16 characters), with or without `GRC-`. */
  reference?: string
  /** `YYYY-MM-DD`, a Pakistan calendar day. */
  submittedOn?: string
  /** `"me"`, `"unassigned"` or a staff member's id. */
  assigned?: string
  sort?: "oldest" | "newest"
  limit?: number
  offset?: number
}

export interface GroceryQueuePage {
  items: GroceryStaffOrderSummaryDto[]
  total: number
  /** Orders per status under the OTHER filters (the status filter is not applied to these). */
  counts: Partial<Record<GroceryStatusDto, number>>
}

function countsOf(value: unknown): GroceryQueuePage["counts"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an unexpected response." })
  }
  return value as GroceryQueuePage["counts"]
}

/** `GET /admin/grocery/orders` — the staff queue. The caller's own orders are never in it. */
export async function fetchGroceryQueue(params: GroceryQueueParams, signal?: AbortSignal): Promise<GroceryQueuePage> {
  const page = await apiRequestPage<GroceryStaffOrderSummaryDto>("GET", `/admin/grocery/orders${queryString({ ...params })}`, {
    signal,
    session: true,
  })
  // Without the server's counts there is nothing honest to show, so a reply without them is a failure.
  return { items: page.items, total: page.meta.total, counts: countsOf(page.extra.counts) }
}

/** `GET /admin/grocery/orders/{id}` — everything needed to handle one order. `403 own_order` for your own. */
export async function fetchGroceryStaffOrder(id: string, signal?: AbortSignal): Promise<GroceryStaffOrderDetailDto> {
  const order = await apiRequest<GroceryStaffOrderDetailDto>("GET", `/admin/grocery/orders/${segment(id)}`, {
    signal,
    session: true,
  })
  if (typeof order?.id !== "string" || !Array.isArray(order.availableActions)) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an unexpected response." })
  }
  return order
}
