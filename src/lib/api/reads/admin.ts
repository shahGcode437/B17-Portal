import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import type {
  AdminCategoryDto,
  AdminListingDto,
  AdminListingSummaryDto,
  ListingStatusDto,
  StatusCountsDto,
} from "@/lib/api/dto/private"
import type { CategoryModule } from "@/lib/api/dto/public"
import { parseCounts } from "@/lib/api/reads/counts"

export interface AdminQueueParams {
  status?: ListingStatusDto
  kind?: AdminListingSummaryDto["kind"]
  limit?: number
  offset?: number
}

export interface AdminQueuePage {
  page: Page<AdminListingSummaryDto>
  /** Per-status counts over the WHOLE queue, ignoring the filters. */
  counts: StatusCountsDto
}

/** `GET /admin/listings` — the moderation queue (pending oldest-first). READ ONLY in Phase 12G. */
export async function fetchAdminQueue(params: AdminQueueParams = {}, signal?: AbortSignal): Promise<AdminQueuePage> {
  const page = await apiRequestPage<AdminListingSummaryDto>("GET", `/admin/listings${queryString({ ...params })}`, {
    signal,
    session: true,
  })
  return { page, counts: parseCounts(page.extra.counts) }
}

/** `GET /admin/listings/{id}` — the full review shape, including the PRIVATE location. */
export function fetchAdminListing(id: string, signal?: AbortSignal): Promise<AdminListingDto> {
  return apiRequest<AdminListingDto>("GET", `/admin/listings/${segment(id)}`, { signal, session: true })
}

/** `GET /admin/categories` — every category, INACTIVE ones included. */
export function fetchAdminCategories(module?: CategoryModule, signal?: AbortSignal): Promise<AdminCategoryDto[]> {
  return apiRequest<AdminCategoryDto[]>("GET", `/admin/categories${queryString({ module })}`, { signal, session: true })
}
