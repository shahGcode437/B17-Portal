import { useAuth } from "@/hooks/useAuth"
import { usePagedRead } from "@/hooks/usePagedRead"
import { useRead } from "@/hooks/useRead"
import { fetchSaved } from "@/lib/api/reads/saved"
import { fetchLeads, fetchMyRequests, fetchRequest } from "@/lib/api/reads/requests"
import {
  toLeadRecord,
  toMyRequestRecord,
  toRequestDetailView,
  toSavedEntry,
  type SavedEntry,
} from "@/lib/api/privateAdapters"

/** How many rows one request asks for on the signed-in lists (the API allows 1-50). */
const PAGE = 12

/**
 * Reads of the signed-in user's own data (Phase 12G). They wait for the auth bootstrap: while the
 * session is still being checked (or the visitor is anonymous) NOTHING is requested - a private
 * read sent before the answer would only fail - and the page keeps showing its loading state. The
 * route guard (`AuthGate`) is what redirects an anonymous visitor; these hooks never navigate.
 */
function useAuthenticated(): boolean {
  return useAuth().status === "authenticated"
}

/** `GET /saved`: the user's saved listings that are still approved, newest save first. Read only. */
export function useSaved() {
  const enabled = useAuthenticated()
  const paged = usePagedRead(
    "saved",
    async (offset, signal) => {
      const page = await fetchSaved({ limit: PAGE, offset }, signal)
      const items = page.items.flatMap((dto) => {
        const entry = toSavedEntry(dto)
        return entry ? [entry] : []
      })
      return { items, raw: page.items.length, total: page.meta.total, extra: undefined }
    },
    { enabled }
  )
  return paged as typeof paged & { items: SavedEntry[] }
}

/** `GET /requests`: the requests the user sent, newest first. Read only. */
export function useMyRequests() {
  const { user, status } = useAuth()
  const name = user?.displayName ?? ""
  return usePagedRead(
    "my-requests",
    async (offset, signal) => {
      const page = await fetchMyRequests({ limit: PAGE, offset }, signal)
      return {
        items: page.items.map((dto) => toMyRequestRecord(dto, name)),
        raw: page.items.length,
        total: page.meta.total,
        extra: undefined,
      }
    },
    { enabled: status === "authenticated" }
  )
}

/** `GET /users/me/leads`: requests sent to the user's own listings. Read only. */
export function useLeads() {
  const enabled = useAuthenticated()
  return usePagedRead(
    "leads",
    async (offset, signal) => {
      const page = await fetchLeads({ limit: PAGE, offset }, signal)
      return { items: page.items.map(toLeadRecord), raw: page.items.length, total: page.meta.total, extra: undefined }
    },
    { enabled }
  )
}

/** `GET /requests/{id}`: one request with its history, fetched when a row is opened. */
export function useRequestDetail(id: string | null) {
  const enabled = useAuthenticated() && id !== null
  return useRead(`request:${id ?? ""}`, async (signal) => toRequestDetailView(await fetchRequest(id ?? "", signal)), {
    enabled,
  })
}

/**
 * How many of the user's requests are still open (submitted, accepted or in progress), from the
 * server's own `meta.total` of one tiny filtered query per open status - an exact number, not a
 * guess from whichever rows happen to be loaded.
 */
export function useActiveRequestCount() {
  const enabled = useAuthenticated()
  return useRead(
    "my-requests:active-count",
    async (signal) => {
      const open = ["submitted", "accepted", "in-progress"] as const
      const pages = await Promise.all(open.map((status) => fetchMyRequests({ status, limit: 1 }, signal)))
      return pages.reduce((sum, page) => sum + page.meta.total, 0)
    },
    { enabled }
  )
}
