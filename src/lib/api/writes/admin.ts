import { apiRequest } from "@/lib/api/client"
import { segment } from "@/lib/api/query"
import type { AdminCategoryDto, AdminListingDto } from "@/lib/api/dto/private"
import type { CategoryModule } from "@/lib/api/dto/public"

/**
 * `POST /admin/listings/{id}/approve` and `/reject` — the reviewer passes the current `revision`
 * (API_CONTRACT §10.2, §10.4). A stale revision is `409 listing_conflict`; approving a non-pending
 * listing is `409 invalid_state_transition`. `reject` also takes a `reason` (10–500 chars) and may
 * take down an approved listing (§10.3 row 5).
 */
export function approveListing(id: string, revision: number): Promise<AdminListingDto> {
  return apiRequest<AdminListingDto>("POST", `/admin/listings/${segment(id)}/approve`, {
    session: true,
    body: { revision },
  })
}

export function rejectListing(id: string, revision: number, reason: string): Promise<AdminListingDto> {
  return apiRequest<AdminListingDto>("POST", `/admin/listings/${segment(id)}/reject`, {
    session: true,
    body: { revision, reason },
  })
}

/** `POST /admin/categories` — code-defined modules only; `slug` is derived from the name if omitted. */
export interface CategoryCreate {
  module: CategoryModule
  name: string
  slug?: string
  parentId?: string
  displayOrder?: number
}

export function createCategory(body: CategoryCreate): Promise<AdminCategoryDto> {
  return apiRequest<AdminCategoryDto>("POST", "/admin/categories", { session: true, body })
}

/** `PATCH /admin/categories/{id}` — `module` and `slug` are immutable. */
export interface CategoryPatch {
  name?: string
  parentId?: string | null
  isActive?: boolean
  displayOrder?: number
}

export function patchCategory(id: string, body: CategoryPatch): Promise<AdminCategoryDto> {
  return apiRequest<AdminCategoryDto>("PATCH", `/admin/categories/${segment(id)}`, { session: true, body })
}

/**
 * `POST /admin/categories/reorder` — send the complete sibling group in the new order.
 * `parentId` is REQUIRED and nullable (API_CONTRACT §10.9): `null` is the top level; leaving the key
 * out is a `422 missing`, which is why it is not optional here.
 */
export interface CategoryReorder {
  module: CategoryModule
  parentId: string | null
  orderedIds: string[]
}

export function reorderCategories(body: CategoryReorder): Promise<AdminCategoryDto[]> {
  return apiRequest<AdminCategoryDto[]>("POST", "/admin/categories/reorder", { session: true, body })
}
