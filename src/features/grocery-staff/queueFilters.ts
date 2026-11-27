import { ALL_STATUSES } from "@/features/grocery/orderStatus"
import type { GroceryQueueParams } from "@/lib/api/reads/groceryStaff"
import type { GroceryStatusDto } from "@/lib/api/dto/grocery"

/**
 * The queue's filters, kept in the address so that Back and a reload keep them. They hold nothing
 * about a customer: a status, an order reference, a day, whose queue, the order and the page.
 * Anything unreadable in the address is ignored rather than sent.
 */
export interface QueueFilters {
  status: GroceryStatusDto | "all"
  reference: string
  submittedOn: string
  /** `""` (anyone), `"me"`, `"unassigned"` or a staff member's id. */
  assigned: string
  sort: "oldest" | "newest"
  page: number
}

export const PAGE_SIZE = 12
/** The API accepts an offset up to 100,000. */
const LAST_PAGE = Math.floor(100_000 / PAGE_SIZE) + 1

/** New orders, longest-waiting first: the work that is waiting. */
export const DEFAULT_FILTERS: QueueFilters = {
  status: "submitted",
  reference: "",
  submittedOn: "",
  assigned: "",
  sort: "oldest",
  page: 1,
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const STAFF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What the API accepts: 3 to 16 characters of a reference, with or without `GRC-`. */
export function referenceProblem(text: string): string | null {
  const value = text.trim()
  if (!value) return null
  if (value.length < 3 || value.length > 16) return "Enter 3 to 16 characters of the order reference."
  return /^[A-Za-z0-9-]+$/.test(value) ? null : "A reference has only letters, numbers and a dash."
}

export function readFilters(params: URLSearchParams): QueueFilters {
  const status = params.get("status")
  const reference = (params.get("ref") ?? "").trim()
  const day = params.get("on") ?? ""
  const assigned = params.get("by") ?? ""
  const page = Number(params.get("page") ?? "1")
  return {
    status: status === "all" || ALL_STATUSES.includes(status as GroceryStatusDto) ? (status as QueueFilters["status"]) : "submitted",
    reference: referenceProblem(reference) ? "" : reference,
    submittedOn: DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : "",
    assigned: assigned === "me" || assigned === "unassigned" || STAFF_ID.test(assigned) ? assigned : "",
    sort: params.get("sort") === "newest" ? "newest" : "oldest",
    page: Number.isInteger(page) && page >= 1 && page <= LAST_PAGE ? page : 1,
  }
}

/** The address of a set of filters; the defaults are left out. */
export function filterSearch(filters: QueueFilters): string {
  const params = new URLSearchParams()
  if (filters.status !== "submitted") params.set("status", filters.status)
  if (filters.reference) params.set("ref", filters.reference)
  if (filters.submittedOn) params.set("on", filters.submittedOn)
  if (filters.assigned) params.set("by", filters.assigned)
  if (filters.sort !== "oldest") params.set("sort", filters.sort)
  if (filters.page > 1) params.set("page", String(filters.page))
  const text = params.toString()
  return text ? `?${text}` : ""
}

export function queueParams(filters: QueueFilters): GroceryQueueParams {
  return {
    ...(filters.status === "all" ? {} : { status: filters.status }),
    ...(filters.reference ? { reference: filters.reference } : {}),
    ...(filters.submittedOn ? { submittedOn: filters.submittedOn } : {}),
    ...(filters.assigned ? { assigned: filters.assigned } : {}),
    sort: filters.sort,
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  }
}
