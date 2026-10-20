/**
 * The backend's READ endpoints as a pure function (test helper only), built on the deterministic
 * payloads in `apiFixtures`. It filters, paginates and 404s the way the real API does
 * (READ_API_PARITY.md). Framework-agnostic - no Vitest, no Playwright - so the unit tests
 * (`fakeBackend`) and the browser suite (`e2e/helpers/authMock`) answer from the SAME contract.
 * Anything it does not know is a `404`, and any write is a `405`, so a test that accidentally
 * mutates fails loudly.
 */
import {
  ADMIN_LISTINGS,
  ADMIN_QUEUE,
  BUSINESSES,
  CATEGORIES,
  LEADS,
  MY_REQUESTS,
  NEWS,
  OWNER_LISTINGS,
  PROPERTIES,
  PROVIDERS,
  REQUEST_HISTORY,
  SAVED,
  TUTORS,
} from "./apiFixtures"
import type { ListingDto, SearchHitDto } from "../../lib/api/dto/public"

export interface ReadReply {
  status: number
  body?: unknown
}

const ok = (data: unknown): ReadReply => ({ status: 200, body: { data } })
const fail = (status: number, code: string): ReadReply => ({
  status,
  body: { error: { code, message: `server text for ${code}`, details: [], requestId: "req-test" } },
})
const okPage = (items: unknown[], meta: Record<string, unknown>): ReadReply => ({
  status: 200,
  body: { data: items, meta: { total: items.length, limit: 50, offset: 0, ...meta } },
})

export const ALL_LISTINGS: ListingDto[] = [...PROVIDERS, ...BUSINESSES, ...TUTORS, ...PROPERTIES]

/** What a search card carries: the public location minus address and landmark (detail-only fields). */
function asCard(listing: ListingDto): ListingDto {
  const copy = JSON.parse(JSON.stringify(listing)) as ListingDto
  if (copy.location) {
    delete copy.location.address
    delete copy.location.landmark
  }
  if (copy.kind === "business" && copy.food) delete copy.food.menuHighlights
  return copy
}

function titleOf(hit: ListingDto): string {
  return hit.kind === "property" ? hit.title : hit.name
}

function haystack(hit: ListingDto): string {
  const parts: string[] = [titleOf(hit), hit.area, hit.tags.join(" ")]
  if (hit.kind === "property") parts.push(hit.propertyType, hit.description ?? "")
  else if (hit.kind === "tutor") parts.push(hit.subject, hit.bio ?? "")
  else parts.push(hit.category, hit.description ?? "")
  return parts.join(" ").toLowerCase()
}

function categorySlugs(hit: ListingDto): string[] {
  return hit.categories.map((c) => c.slug)
}

function matches(hit: ListingDto, q: URLSearchParams): boolean {
  const type = q.get("type")
  if (type && hit.kind !== type) return false
  const text = q.get("q")?.trim().toLowerCase()
  if (text && !haystack(hit).includes(text)) return false
  const area = q.get("area")
  if (area && hit.area !== area) return false
  const category = q.get("category")
  if (category && !categorySlugs(hit).includes(category)) return false
  const subject = q.get("subject")
  if (subject && !(hit.kind === "tutor" && categorySlugs(hit).includes(subject))) return false
  const grade = q.get("grade")
  if (grade && !(hit.kind === "tutor" && hit.grade === grade)) return false
  const propertyType = q.get("propertyType")
  if (propertyType && !(hit.kind === "property" && categorySlugs(hit).includes(propertyType))) return false
  const listingType = q.get("listingType")
  if (listingType && !(hit.kind === "property" && hit.listingType === listingType)) return false
  const bedrooms = q.get("bedrooms")
  if (bedrooms && !(hit.kind === "property" && hit.bedrooms === Number(bedrooms))) return false
  const vertical = q.get("vertical")
  if (vertical && !(hit.kind === "business" && hit.vertical === vertical)) return false
  const foodCategory = q.get("foodCategory")
  if (foodCategory && !(hit.kind === "business" && hit.food?.categories.includes(foodCategory))) return false
  const service = q.get("service")
  if (service && !(hit.kind === "business" && (hit.food?.serviceOptions as string[] | undefined)?.includes(service))) return false
  return true
}

function page(items: unknown[], q: URLSearchParams, extra: Record<string, unknown> = {}): ReadReply {
  const limit = Math.min(Number(q.get("limit") ?? 50) || 50, 50)
  const offset = Number(q.get("offset") ?? 0) || 0
  return okPage(items.slice(offset, offset + limit), { total: items.length, limit, offset, ...extra })
}

function countsOf(listings: { status: string }[]) {
  const counts = { pending: 0, approved: 0, rejected: 0, archived: 0 }
  for (const l of listings) counts[l.status as keyof typeof counts] += 1
  return counts
}

const NOT_FOUND = () => fail(404, "not_found")

/**
 * Answers one API request. `me` is the signed-in user as `/auth/me` reports it (or null when signed
 * out) - only its `roles` matter here. Returns null for a path that is not a read endpoint, so a
 * caller can fall through to its own routes (auth, writes).
 */
export function routeRead(method: string, path: string, q: URLSearchParams, me: { roles?: string[] } | null): ReadReply | null {
  {
    if (method !== "GET") return null

    if (path === "/categories") {
      const module = q.get("module")
      return ok(CATEGORIES.filter((c) => c.isActive && (!module || c.module === module)))
    }
    if (path === "/search/suggestions") {
      const text = q.get("q")?.trim().toLowerCase() ?? ""
      if (text.length < 2) return ok([])
      return ok(
        ALL_LISTINGS.filter((l) => haystack(l).includes(text)).map((l) => ({
          id: l.id,
          label: titleOf(l),
          secondaryLabel: `${l.kind} - ${l.area}`,
          type: l.kind,
          value: titleOf(l),
        }))
      )
    }
    if (path === "/search") {
      const type = q.get("type")
      const hits: SearchHitDto[] = ALL_LISTINGS.filter((l) => matches(l, q)).map(
        (item) => ({ kind: item.kind, item: asCard(item) }) as SearchHitDto
      )
      const wantsNews = (!type || type === "news") && !q.get("area") && !q.get("category") && !q.get("vertical")
      if (wantsNews) {
        const text = q.get("q")?.toLowerCase()
        for (const item of NEWS) {
          if (!text || `${item.title} ${item.summary}`.toLowerCase().includes(text)) hits.push({ kind: "news", item })
        }
      }
      return page(hits, q)
    }
    const listing = /^\/listings\/(.+)$/.exec(path)
    if (listing) {
      const found = ALL_LISTINGS.find((l) => l.id === decodeURIComponent(listing[1]))
      return found ? ok(found) : NOT_FOUND()
    }
    if (path === "/news") {
      const kind = q.get("kind")
      const items = NEWS.filter((n) => !kind || n.kind === kind).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      return page(items, q)
    }
    const news = /^\/news\/(.+)$/.exec(path)
    if (news) {
      const found = NEWS.find((n) => n.id === decodeURIComponent(news[1]))
      return found ? ok(found) : NOT_FOUND()
    }

    // Private reads require a signed-in session, exactly like the real API.
    if (!me) return fail(401, "unauthenticated")

    if (path === "/saved") return page(SAVED, q)
    if (path === "/requests") {
      const status = q.get("status")
      return page(MY_REQUESTS.filter((r) => !status || r.status === status), q)
    }
    const request = /^\/requests\/(.+)$/.exec(path)
    if (request) {
      const id = decodeURIComponent(request[1])
      const found = [...MY_REQUESTS, ...LEADS].find((r) => r.id === id)
      return found ? ok({ ...found, history: REQUEST_HISTORY[id] ?? [] }) : NOT_FOUND()
    }
    if (path === "/users/me/leads") {
      const status = q.get("status")
      return page(LEADS.filter((r) => !status || r.status === status), q)
    }
    if (path === "/users/me/listings") {
      const status = q.get("status")
      return page(OWNER_LISTINGS.filter((l) => !status || l.status === status), q, { counts: countsOf(OWNER_LISTINGS) })
    }
    const owner = /^\/users\/me\/listings\/(.+)$/.exec(path)
    if (owner) {
      const found = OWNER_LISTINGS.find((l) => l.id === decodeURIComponent(owner[1]))
      return found ? ok(found) : NOT_FOUND()
    }

    // Admin reads need the admin role.
    const roles = me.roles ?? []
    if (path.startsWith("/admin") && !roles.includes("admin")) return fail(403, "forbidden")
    if (path === "/admin/listings") {
      const status = q.get("status")
      return page(ADMIN_QUEUE.filter((l) => !status || l.status === status), q, { counts: countsOf(ADMIN_QUEUE) })
    }
    const admin = /^\/admin\/listings\/(.+)$/.exec(path)
    if (admin) {
      const found = ADMIN_LISTINGS.find((l) => l.id === decodeURIComponent(admin[1]))
      return found ? ok(found) : NOT_FOUND()
    }
    if (path === "/admin/categories") {
      const module = q.get("module")
      return ok(CATEGORIES.filter((c) => !module || c.module === module))
    }
    return NOT_FOUND()
  }
}
