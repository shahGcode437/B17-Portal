import { useAuth } from "@/hooks/useAuth"
import { usePagedRead } from "@/hooks/usePagedRead"
import { useRead } from "@/hooks/useRead"
import { fetchOwnerListing, fetchOwnerListings } from "@/lib/api/reads/owner"
import { fetchAdminCategories, fetchAdminListing, fetchAdminQueue } from "@/lib/api/reads/admin"
import { fetchLeads } from "@/lib/api/reads/requests"
import { fetchNewsList } from "@/lib/api/reads/news"
import type { ListingStatusDto, RequestStatusDto, StatusCountsDto } from "@/lib/api/dto/private"
import { toAdminCategory, toAdminListing, toAdminQueueRow, toOwnerListing } from "@/lib/api/ownerAdapters"

/** Rows per request on the owner and admin lists (the API allows 1-50). */
const PAGE = 12

/**
 * Reads for the Professional and Admin workspaces (Phase 12G). Like the resident reads they send
 * nothing until the session is confirmed; the admin reads additionally wait for the `admin` role
 * that `/auth/me` reported. The route guards own the redirects and the API re-checks everything.
 */
function useWorkspaceAuth(requiresAdmin: boolean): boolean {
  const { status, user } = useAuth()
  return status === "authenticated" && (!requiresAdmin || Boolean(user?.roles.includes("admin")))
}

/** `GET /users/me/listings`: my listings in every status, newest first; `extra` holds the per-status counts. */
export function useOwnerListings(status?: ListingStatusDto) {
  const enabled = useWorkspaceAuth(false)
  return usePagedRead(
    `owner:${status ?? "all"}`,
    async (offset, signal) => {
      const { page, counts } = await fetchOwnerListings({ status, limit: PAGE, offset }, signal)
      return { items: page.items.map(toOwnerListing), raw: page.items.length, total: page.meta.total, extra: counts }
    },
    { enabled }
  )
}

/** Per-status counts of ALL my listings: one tiny request (the server counts, nothing is guessed). */
export function useOwnerCounts() {
  const enabled = useWorkspaceAuth(false)
  return useRead("owner:counts", async (signal): Promise<StatusCountsDto> => (await fetchOwnerListings({ limit: 1 }, signal)).counts, {
    enabled,
  })
}

/** `GET /users/me/listings/{id}`: one of my listings, fetched when its preview opens. */
export function useOwnerListing(id: string | null) {
  const enabled = useWorkspaceAuth(false) && id !== null
  return useRead(`owner-listing:${id ?? ""}`, async (signal) => toOwnerListing(await fetchOwnerListing(id ?? "", signal)), {
    enabled,
  })
}

const REQUEST_STATUSES: RequestStatusDto[] = ["submitted", "accepted", "in-progress", "completed", "cancelled"]

/** How many leads are in each status, from the server's own totals (five tiny requests). */
export function useLeadStatusCounts() {
  const enabled = useWorkspaceAuth(false)
  return useRead(
    "leads:counts",
    async (signal) => {
      const pages = await Promise.all(REQUEST_STATUSES.map((status) => fetchLeads({ status, limit: 1 }, signal)))
      return Object.fromEntries(REQUEST_STATUSES.map((status, index) => [status, pages[index].meta.total])) as Record<
        RequestStatusDto,
        number
      >
    },
    { enabled }
  )
}

/** `GET /admin/listings`: the moderation queue; `extra` holds the whole-queue per-status counts. */
export function useAdminQueue(status?: ListingStatusDto) {
  const enabled = useWorkspaceAuth(true)
  return usePagedRead(
    `admin-queue:${status ?? "all"}`,
    async (offset, signal) => {
      const { page, counts } = await fetchAdminQueue({ status, limit: PAGE, offset }, signal)
      return { items: page.items.map(toAdminQueueRow), raw: page.items.length, total: page.meta.total, extra: counts }
    },
    { enabled }
  )
}

/** Whole-queue counts only (the dashboard): one tiny request. */
export function useAdminCounts() {
  const enabled = useWorkspaceAuth(true)
  return useRead("admin-queue:counts", async (signal): Promise<StatusCountsDto> => (await fetchAdminQueue({ limit: 1 }, signal)).counts, {
    enabled,
  })
}

/** `GET /admin/listings/{id}`: the full review view, including the private location and history. */
export function useAdminListing(id: string | null) {
  const enabled = useWorkspaceAuth(true) && id !== null
  return useRead(`admin-listing:${id ?? ""}`, async (signal) => toAdminListing(await fetchAdminListing(id ?? "", signal)), {
    enabled,
  })
}

/** `GET /admin/categories`: every category, inactive ones included. */
export function useAdminCategories() {
  const enabled = useWorkspaceAuth(true)
  return useRead("admin-categories", async (signal) => (await fetchAdminCategories(undefined, signal)).map(toAdminCategory), {
    enabled,
  })
}

/** How many news items are published, from the public list's own total. */
export function usePublishedNewsTotal() {
  const enabled = useWorkspaceAuth(true)
  return useRead("news:published-total", async (signal) => (await fetchNewsList({ limit: 1 }, signal)).meta.total, {
    enabled,
  })
}
