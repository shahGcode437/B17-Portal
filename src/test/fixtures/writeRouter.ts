/**
 * The backend's WRITE endpoints as a stateful in-memory server (test helper only, Phase 12H).
 *
 * Framework-agnostic — the same handler serves Vitest (through `installFetchMock`) and Playwright
 * (through `e2e/helpers/authMock`). It is a thin honest implementation of the frozen contract
 * (`API_CONTRACT.md §10`): per-user listings, revision concurrency on PATCH / approve / reject /
 * archive, Saved idempotence, request state machine, admin takedown. Not every edge case the real
 * server enforces is simulated — but enough that an E2E can prove the UI's effect without pretending.
 *
 * Call `resetWriteState()` between tests to drop everything created by the previous run.
 */
import { BUSINESSES, CATEGORIES, LEADS, MY_REQUESTS, OWNER_LISTINGS, PROPERTIES, PROVIDERS, REQUEST_HISTORY, TUTORS } from "./apiFixtures"
import type {
  AdminCategoryDto,
  LeadSummaryDto,
  OwnerListingDto,
  RequestDetailDto,
  RequestHistoryEntryDto,
  RequestStatusDto,
  RequestSummaryDto,
  SavedHitDto,
} from "../../lib/api/dto/private"
import type { ListingDto } from "../../lib/api/dto/public"

export interface WriteReply {
  status: number
  body?: unknown
}

const ok = (data: unknown): WriteReply => ({ status: 200, body: { data } })
const created = (data: unknown): WriteReply => ({ status: 201, body: { data } })
const noContent = (): WriteReply => ({ status: 204 })
const fail = (status: number, code: string, details: unknown[] = []): WriteReply => ({
  status,
  body: { error: { code, message: `server text for ${code}`, details, requestId: "req-test" } },
})

// Mutable state. Resets each test.
interface State {
  listings: OwnerListingDto[]
  savedIds: Set<string>
  myRequests: RequestSummaryDto[]
  leads: LeadSummaryDto[]
  history: Record<string, RequestHistoryEntryDto[]>
  categories: AdminCategoryDto[]
  nextSerial: number
}

let state: State = freshState()

import { SAVED } from "./apiFixtures"

function freshState(): State {
  return {
    listings: OWNER_LISTINGS.map((l) => JSON.parse(JSON.stringify(l)) as OwnerListingDto),
    // Preseed from SAVED so a signed-in user's Saved list starts with the fixture rows (not empty).
    savedIds: new Set<string>(SAVED.map((s) => s.item.id)),
    myRequests: MY_REQUESTS.map((r) => ({ ...r })),
    leads: LEADS.map((r) => ({ ...r })),
    history: Object.fromEntries(Object.entries(REQUEST_HISTORY).map(([id, rows]) => [id, rows.map((r) => ({ ...r }))])),
    categories: CATEGORIES.map((c) => ({ ...c })),
    nextSerial: 1000,
  }
}

export function resetWriteState(): void {
  state = freshState()
}

/** The state is the test fixture's current truth; the read router may read these directly. */
export function writeState(): State {
  return state
}

const uuid = (): string => `11111111-1111-4111-8111-${String(state.nextSerial++).padStart(12, "0")}`

function nowIso(): string {
  return new Date().toISOString()
}

function requireFields(body: Record<string, unknown>, fields: string[]): WriteReply | null {
  for (const field of fields) {
    const v = body[field]
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return fail(422, "validation_error", [{ field, code: "required" }])
    }
  }
  return null
}

function listingToPublic(listing: OwnerListingDto): ListingDto {
  // Only approved listings leak into public reads; the owner shape minus privateLocation is enough.
  const base = {
    id: listing.id,
    area: listing.area,
    location: listing.publicLocation,
    image: listing.image,
    tags: listing.tags,
    categories: listing.categories,
  }
  if (listing.kind === "provider")
    return { ...base, kind: "provider", name: listing.name, category: listing.category, categoryLabel: listing.categoryLabel, description: listing.description } as ListingDto
  if (listing.kind === "tutor")
    return { ...base, kind: "tutor", name: listing.name, subject: listing.categoryLabel, grade: listing.grade, bio: listing.description } as unknown as ListingDto
  if (listing.kind === "property")
    return { ...base, kind: "property", title: listing.title, listingType: listing.listingType, propertyType: listing.propertyType, price: listing.price, description: listing.description, bedrooms: listing.bedrooms, furnished: listing.furnished } as ListingDto
  // business
  return { ...base, kind: "business", name: listing.name, vertical: listing.vertical, category: listing.category ?? listing.categoryLabel, description: listing.description, food: listing.food } as ListingDto
}

/**
 * Public listings = (a) the deterministic public fixtures that the read tests use, plus (b) the
 * approved rows from the mutable owner state (so an admin-approved listing becomes publicly readable
 * in the same session). The two sets never overlap by id (the public fixtures use different UUIDs).
 */
const PUBLIC_FIXTURES: ListingDto[] = [...PROVIDERS, ...BUSINESSES, ...TUTORS, ...PROPERTIES]
export function publicApprovedListings(): ListingDto[] {
  return [...PUBLIC_FIXTURES, ...state.listings.filter((l) => l.status === "approved").map(listingToPublic)]
}

/** The current saved rows for the signed-in user (resolved against the current approved listings). */
export function savedRows(): SavedHitDto[] {
  const approved = publicApprovedListings()
  return [...state.savedIds]
    .map((id) => approved.find((l) => l.id === id))
    .filter((item): item is ListingDto => item !== undefined)
    .map((item) => ({ kind: item.kind, item, savedAt: nowIso() }) as SavedHitDto)
}

function toPrivateLocation(location: Record<string, unknown>): OwnerListingDto["location"] {
  return {
    visibility: location.visibility as "exact" | "approximate" | "area_only",
    ...(location.block ? { block: String(location.block) } : {}),
    ...(location.address ? { address: String(location.address) } : {}),
    ...(location.landmark ? { landmark: String(location.landmark) } : {}),
    ...(typeof location.latitude === "number" ? { latitude: location.latitude } : {}),
    ...(typeof location.longitude === "number" ? { longitude: location.longitude } : {}),
  }
}

function toPublicLocation(l: OwnerListingDto["location"]): OwnerListingDto["publicLocation"] {
  return {
    visibility: l.visibility,
    ...(l.block ? { block: l.block } : {}),
    ...(l.visibility === "exact" ? { address: l.address, landmark: l.landmark } : {}),
    ...(l.visibility !== "area_only" && l.latitude !== undefined && l.longitude !== undefined
      ? { coordinates: { latitude: l.latitude, longitude: l.longitude, precision: l.visibility } }
      : {}),
  }
}

/** The taxonomy module a kind's category belongs to (API_CONTRACT §10.6). */
const MODULE_OF: Record<string, string> = { provider: "services", tutor: "education", property: "property" }

function activeCategory(module: string, slug: unknown): AdminCategoryDto | undefined {
  return state.categories.find((c) => c.module === module && c.slug === slug && c.isActive)
}

/**
 * The real backend refuses a category that is not an ACTIVE slug of the right module
 * (`422 validation_error`, `unknown_category`): a label or free text never passes. Mirroring that
 * means a form that sends a label fails in the browser suite exactly as it would against the real API.
 */
function checkCategories(kind: string, body: Record<string, unknown>, isPatch = false): { reply: WriteReply } | null {
  const bad = (field: string): { reply: WriteReply } => ({ reply: fail(422, "validation_error", [{ field, code: "unknown_category" }]) })
  const sent = (key: string) => !isPatch || body[key] !== undefined
  if (kind === "business") {
    if (body.vertical === "food") {
      if (!isPatch || body.food) {
        const cats = (body.food as { categories?: unknown[] } | undefined)?.categories
        if (!Array.isArray(cats) || cats.length < 1 || cats.length > 3) return { reply: fail(422, "validation_error", [{ field: "food.categories", code: "required" }]) }
        if (!cats.every((slug) => activeCategory("food", slug))) return bad("food.categories")
      }
      if (body.category !== undefined && body.category !== null) return { reply: fail(422, "validation_error", [{ field: "category", code: "not_allowed" }]) }
    } else if (sent("category") && !activeCategory("directory", body.category)) return bad("category")
    return null
  }
  if (kind === "property") {
    if (sent("propertyType") && !activeCategory("property", body.propertyType)) return bad("propertyType")
    return null
  }
  if (sent("category") && !activeCategory(MODULE_OF[kind], body.category)) return bad("category")
  return null
}

function categoryRefs(kind: string, body: Record<string, unknown>) {
  if (kind === "business" && body.vertical === "food") {
    return ((body.food as { categories?: string[] })?.categories ?? []).map((slug, i) => ({
      slug,
      name: activeCategory("food", slug)?.name ?? slug,
      isPrimary: i === 0,
    }))
  }
  const module = kind === "business" ? "directory" : MODULE_OF[kind]
  const slug = kind === "property" ? body.propertyType : body.category
  const row = activeCategory(module, slug)
  return row ? [{ slug: row.slug, name: row.name, isPrimary: true }] : []
}

function categoryLabelFor(kind: string, body: Record<string, unknown>): string {
  const refs = categoryRefs(kind, body)
  return refs.map((r) => r.name).join(", ") || "General"
}

/** The fields an owner can change; compared before and after a PATCH to detect a no-op. */
function editableView(l: OwnerListingDto): unknown {
  return {
    name: "name" in l ? l.name : undefined,
    title: "title" in l ? l.title : undefined,
    description: l.description,
    area: l.area,
    tags: l.tags,
    image: l.image ?? null,
    location: l.location,
    categories: l.categories.map((c) => c.slug),
    grade: "grade" in l ? l.grade : undefined,
    listingType: "listingType" in l ? l.listingType : undefined,
    price: "price" in l ? l.price : undefined,
    bedrooms: "bedrooms" in l ? (l.bedrooms ?? null) : undefined,
    furnished: "furnished" in l ? (l.furnished ?? null) : undefined,
    food: "food" in l ? l.food : undefined,
  }
}

function applyPatch(l: OwnerListingDto, body: Record<string, unknown>): void {
  if (typeof body.name === "string" && "name" in l) l.name = body.name
  if (typeof body.title === "string" && "title" in l) l.title = body.title
  if (typeof body.description === "string") l.description = body.description
  if (typeof body.area === "string") l.area = body.area
  if (Array.isArray(body.tags)) l.tags = body.tags as string[]
  if (body.image === null) delete l.image
  else if (typeof body.image === "string") l.image = body.image
  if (body.location && typeof body.location === "object") {
    l.location = toPrivateLocation(body.location as Record<string, unknown>)
    l.publicLocation = toPublicLocation(l.location)
  }
  if (l.kind === "tutor" && typeof body.grade === "string") l.grade = body.grade
  if (l.kind === "property") {
    if (body.listingType === "sale" || body.listingType === "rent") l.listingType = body.listingType
    if (typeof body.price === "string") l.price = body.price
    if (typeof body.bedrooms === "number") l.bedrooms = body.bedrooms
    else if (body.bedrooms === null) delete l.bedrooms
    if (typeof body.furnished === "string") l.furnished = body.furnished as typeof l.furnished
    else if (body.furnished === null) delete l.furnished
    if (typeof body.propertyType === "string") {
      l.categories = categoryRefs("property", body)
      l.categoryLabel = categoryLabelFor("property", body)
      l.propertyType = l.categoryLabel
    }
  } else if (l.kind === "business") {
    if (body.vertical === "food" && body.food) {
      l.vertical = "food"
      l.food = body.food as typeof l.food
      delete l.category
      l.categories = categoryRefs("business", body)
      l.categoryLabel = categoryLabelFor("business", body)
    } else if (body.vertical === "general") {
      l.vertical = "general"
      delete l.food
      if (typeof body.category === "string") {
        l.categories = categoryRefs("business", body)
        l.categoryLabel = categoryLabelFor("business", body)
        l.category = l.categoryLabel
      }
    }
  } else if (l.kind === "provider" || l.kind === "tutor") {
    if (typeof body.category === "string") {
      l.categories = categoryRefs(l.kind, body)
      l.categoryLabel = categoryLabelFor(l.kind, body)
      if (l.kind === "provider") l.category = body.category
    }
  }
}

/**
 * Handle one write (or a read against the mutable state). Returns null if the path is not a write
 * endpoint, so the caller falls through to `routeRead` using the mutable state as the fixture.
 */
export function routeWrite(
  method: string,
  path: string,
  body: Record<string, unknown>,
  me: { roles?: string[]; displayName?: string; professional?: boolean; emailVerified?: boolean } | null
): WriteReply | null {
  // Everything below is session-bound.
  if (!me) {
    if (method === "GET") return null
    return fail(401, "unauthenticated")
  }
  const isAdmin = (me.roles ?? []).includes("admin")

  // -- Saved ------------------------------------------------------------------------------------
  const saveMatch = /^\/saved\/(.+)$/.exec(path)
  if (saveMatch) {
    const id = decodeURIComponent(saveMatch[1])
    if (method === "PUT") {
      if (!publicApprovedListings().some((l) => l.id === id)) return fail(404, "not_found")
      state.savedIds.add(id)
      return noContent()
    }
    if (method === "DELETE") {
      state.savedIds.delete(id)
      return noContent()
    }
  }

  // -- Requests ---------------------------------------------------------------------------------
  if (path === "/requests" && method === "POST") {
    const required = requireFields(body, ["providerListingId", "service", "details", "area", "preferredDate", "preferredContactChannel"])
    if (required) return required
    const target = state.listings.find((l) => l.id === body.providerListingId && l.status === "approved")
    if (!target) return fail(404, "not_found")
    if (target.kind !== "provider") return fail(422, "not_requestable")
    const requesterName = me.displayName ?? "Requester"
    const providerName = (target as { name: string }).name
    const id = uuid()
    const row: RequestSummaryDto = {
      id,
      providerListingId: target.id,
      providerName,
      service: String(body.service),
      details: String(body.details),
      area: String(body.area),
      preferredDate: String(body.preferredDate),
      ...(body.preferredTime ? { preferredTime: String(body.preferredTime) } : {}),
      ...(body.notes ? { notes: String(body.notes) } : {}),
      preferredContactChannel: body.preferredContactChannel as RequestSummaryDto["preferredContactChannel"],
      status: "submitted",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    state.myRequests.unshift(row)
    state.leads.unshift({ ...row, requesterName })
    state.history[id] = [{ toStatus: "submitted", actorRole: "requester", createdAt: nowIso() }]
    const detail: RequestDetailDto = { ...row, requesterName, viewerRole: "requester", history: state.history[id] }
    return created(detail)
  }
  const action = /^\/requests\/([^/]+)\/(accept|start|complete|cancel)$/.exec(path)
  if (action && method === "POST") {
    const id = decodeURIComponent(action[1])
    const act = action[2] as "accept" | "start" | "complete" | "cancel"
    const row = state.myRequests.find((r) => r.id === id) ?? state.leads.find((r) => r.id === id)
    if (!row) return fail(404, "not_found")
    const next: Record<string, RequestStatusDto> = { accept: "accepted", start: "in-progress", complete: "completed", cancel: "cancelled" }
    const allowed: Record<string, RequestStatusDto[]> = {
      accept: ["submitted"],
      start: ["accepted"],
      complete: ["in-progress"],
      cancel: ["submitted", "accepted", "in-progress"],
    }
    if (!allowed[act].includes(row.status)) return fail(409, "invalid_state_transition")
    const from = row.status
    const to = next[act]
    const stamp = nowIso()
    row.status = to
    row.updatedAt = stamp
    // mirror the status change into both lists
    for (const list of [state.myRequests, state.leads] as (typeof state.myRequests)[]) {
      const mirror = list.find((r) => r.id === id)
      if (mirror) {
        mirror.status = to
        mirror.updatedAt = stamp
      }
    }
    const history = (state.history[id] ??= [])
    history.push({ fromStatus: from, toStatus: to, actorRole: act === "cancel" ? "requester" : "provider", createdAt: stamp })
    const lead = state.leads.find((r) => r.id === id)
    const requesterName = lead?.requesterName ?? me.displayName ?? "Requester"
    const detail: RequestDetailDto = { ...row, requesterName, viewerRole: "provider", history }
    return ok(detail)
  }

  // -- Listings (owner) ------------------------------------------------------------------------
  // The real guard order (AUTH_RBAC.md): a verified e-mail, THEN a professional profile. A Resident
  // without a profile gets `403 professional_profile_required` and nothing is written.
  const isListingWrite =
    (path === "/listings" && method === "POST") ||
    (/^\/listings\/[^/]+$/.test(path) && method === "PATCH") ||
    (/^\/listings\/[^/]+\/archive$/.test(path) && method === "POST")
  if (isListingWrite) {
    if (me.emailVerified === false) return fail(403, "email_not_verified")
    if (!me.professional) return fail(403, "professional_profile_required")
  }

  if (path === "/listings" && method === "POST") {
    const kind = String(body.kind ?? "")
    if (!["provider", "business", "tutor", "property"].includes(kind)) return fail(422, "validation_error", [{ field: "kind", code: "required" }])
    const required = requireFields(body, kind === "property" ? ["title", "listingType", "propertyType", "price"] : ["name"])
    if (required) return required
    const location = (body.location ?? {}) as Record<string, unknown>
    if (!["exact", "approximate", "area_only"].includes(String(location.visibility ?? "")))
      return fail(422, "validation_error", [{ field: "location.visibility", code: "required" }])
    if (kind === "property" && location.visibility === "area_only")
      return fail(422, "validation_error", [{ field: "location.visibility", code: "required" }])

    const categoryError = checkCategories(kind, body)
    if (categoryError) return categoryError.reply

    const id = uuid()
    const privateLocation = toPrivateLocation(location)
    const base = {
      id,
      status: "pending" as const,
      revision: 1,
      area: String(body.area ?? "B-17"),
      location: privateLocation,
      publicLocation: toPublicLocation(privateLocation),
      description: typeof body.description === "string" ? body.description : "",
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      ...(typeof body.image === "string" ? { image: body.image } : {}),
      categories: categoryRefs(kind, body),
      categoryLabel: categoryLabelFor(kind, body),
      submittedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    let listing: OwnerListingDto
    if (kind === "property") {
      listing = {
        ...base,
        kind: "property",
        title: String(body.title),
        listingType: body.listingType as "sale" | "rent",
        propertyType: categoryLabelFor(kind, body),
        price: String(body.price),
        ...(typeof body.bedrooms === "number" ? { bedrooms: body.bedrooms } : {}),
        ...(body.furnished ? { furnished: body.furnished as "Furnished" | "Unfurnished" | "Semi-Furnished" } : {}),
      }
    } else if (kind === "tutor") {
      listing = { ...base, kind: "tutor", name: String(body.name), category: String(body.category ?? ""), grade: String(body.grade ?? "") }
    } else if (kind === "business") {
      listing = {
        ...base,
        kind: "business",
        name: String(body.name),
        vertical: (body.vertical as "general" | "food") ?? "general",
        ...(body.vertical === "food" ? {} : { category: categoryLabelFor(kind, body) }),
        ...(body.vertical === "food" ? { food: body.food as Extract<OwnerListingDto, { kind: "business" }>["food"] } : {}),
      }
    } else {
      listing = { ...base, kind: "provider", name: String(body.name), category: String(body.category ?? "") }
    }
    state.listings.push(listing)
    return created(listing)
  }

  const archive = /^\/listings\/([^/]+)\/archive$/.exec(path)
  if (archive && method === "POST") {
    const id = decodeURIComponent(archive[1])
    const listing = state.listings.find((l) => l.id === id)
    if (!listing) return fail(404, "not_found")
    if (typeof body.revision !== "number") return fail(422, "validation_error", [{ field: "revision", code: "required" }])
    if (body.revision !== listing.revision) return fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }])
    if (listing.status === "archived") return fail(409, "invalid_state_transition")
    listing.status = "archived"
    listing.revision += 1
    listing.updatedAt = nowIso()
    return ok(listing)
  }
  const patchMatch = /^\/listings\/([^/]+)$/.exec(path)
  if (patchMatch && method === "PATCH") {
    const id = decodeURIComponent(patchMatch[1])
    const listing = state.listings.find((l) => l.id === id)
    if (!listing) return fail(404, "not_found")
    if (typeof body.revision !== "number") return fail(422, "validation_error", [{ field: "revision", code: "required" }])
    if (body.revision !== listing.revision) return fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }])
    if (listing.status === "archived") return fail(409, "invalid_state_transition")

    // The category fields of a PATCH are validated against the server taxonomy exactly like a create.
    const categoryError = checkCategories(listing.kind, body, true)
    if (categoryError) return categoryError.reply

    const before = JSON.stringify(editableView(listing))
    applyPatch(listing, body)
    const changed = JSON.stringify(editableView(listing)) !== before
    if (!changed) {
      // A no-op PATCH: 200 and nothing changes - except a REJECTED listing, which may not loop
      // through moderation without an edit (API_CONTRACT §10.3).
      if (listing.status === "rejected") return fail(422, "validation_error", [{ field: "request", code: "no_changes" }])
      return ok(listing)
    }
    // Every effective change by the owner returns the listing to pending. (The real backend keeps the
    // status for a PURE visibility narrowing; this mock does not simulate that single exception.)
    listing.status = "pending"
    delete listing.rejectionReason
    listing.revision += 1
    listing.submittedAt = nowIso()
    listing.updatedAt = nowIso()
    return ok(listing)
  }

  // -- Admin ------------------------------------------------------------------------------------
  if (path.startsWith("/admin")) {
    if (!isAdmin) return fail(403, "forbidden")
    const approve = /^\/admin\/listings\/([^/]+)\/approve$/.exec(path)
    if (approve && method === "POST") {
      const id = decodeURIComponent(approve[1])
      const listing = state.listings.find((l) => l.id === id)
      if (!listing) return fail(404, "not_found")
      if (typeof body.revision !== "number") return fail(422, "validation_error", [{ field: "revision", code: "required" }])
      if (body.revision !== listing.revision) return fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }])
      if (listing.status !== "pending") return fail(409, "invalid_state_transition")
      listing.status = "approved"
      listing.updatedAt = nowIso()
      return ok(listing)
    }
    const reject = /^\/admin\/listings\/([^/]+)\/reject$/.exec(path)
    if (reject && method === "POST") {
      const id = decodeURIComponent(reject[1])
      const listing = state.listings.find((l) => l.id === id)
      if (!listing) return fail(404, "not_found")
      if (typeof body.revision !== "number") return fail(422, "validation_error", [{ field: "revision", code: "required" }])
      if (body.revision !== listing.revision) return fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }])
      const reason = typeof body.reason === "string" ? body.reason.trim() : ""
      if (reason.length < 10) return fail(422, "validation_error", [{ field: "reason", code: "too_short" }])
      if (listing.status !== "pending" && listing.status !== "approved") return fail(409, "invalid_state_transition")
      listing.status = "rejected"
      listing.rejectionReason = reason
      listing.updatedAt = nowIso()
      return ok(listing)
    }
    if (path === "/admin/categories" && method === "POST") {
      const name = typeof body.name === "string" ? body.name.trim() : ""
      const module = String(body.module ?? "")
      if (name.length < 2) return fail(422, "validation_error", [{ field: "name", code: "required" }])
      const slug = typeof body.slug === "string" && body.slug ? body.slug : name.toLowerCase().replace(/\s+/g, "-")
      const row: AdminCategoryDto = {
        id: uuid(),
        module: module as AdminCategoryDto["module"],
        slug,
        name,
        displayOrder: state.categories.filter((c) => c.module === module).length + 1,
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      state.categories.push(row)
      return created(row)
    }
    const catPatch = /^\/admin\/categories\/([^/]+)$/.exec(path)
    if (catPatch && method === "PATCH") {
      const id = decodeURIComponent(catPatch[1])
      const row = state.categories.find((c) => c.id === id)
      if (!row) return fail(404, "not_found")
      if (typeof body.name === "string") row.name = body.name
      if (typeof body.isActive === "boolean") row.isActive = body.isActive
      if (typeof body.displayOrder === "number") row.displayOrder = body.displayOrder
      row.updatedAt = nowIso()
      return ok(row)
    }
    if (path === "/admin/categories/reorder" && method === "POST") {
      const module = String(body.module ?? "")
      const orderedIds = Array.isArray(body.orderedIds) ? (body.orderedIds as string[]) : []
      const siblings = state.categories.filter((c) => c.module === module)
      for (const [index, id] of orderedIds.entries()) {
        const sibling = siblings.find((s) => s.id === id)
        if (sibling) sibling.displayOrder = index + 1
      }
      return ok(siblings.slice().sort((a, b) => a.displayOrder - b.displayOrder))
    }
  }

  return null
}
