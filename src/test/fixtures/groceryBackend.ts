/**
 * The customer Grocery API as an in-memory object (test helper only; nothing here ships). It follows
 * the real contract (`docs/backend/API_CONTRACT.md` §18 and §19.8): the order of refusal, the
 * idempotency rule (a stored key is answered BEFORE any business rule), ownership (`404`), the
 * revision check on cancellation, and what a customer is and is not shown. Framework-agnostic, so
 * Vitest (over `fetch`) and the mocked Playwright lane (over `page.route`) use the SAME behaviour.
 *
 * `staff*` methods stand in for what staff do through their own API, which the customer app never
 * calls: they only change what the customer's reads return.
 */
import type {
  GroceryAgreementDto,
  GroceryAvailabilityDto,
  GroceryHistoryDto,
  GroceryItemDto,
  GroceryOrderCreateDto,
  GroceryOrderDetailDto,
  GroceryOrderSummaryDto,
  GroceryStatusDto,
  GroceryUnitRuleDto,
} from "../../lib/api/dto/grocery"

export const UNIT_RULES: GroceryUnitRuleDto[] = [
  { unit: "kg", minimum: "0.05", maximum: "50", step: "0.001" },
  { unit: "gram", minimum: "1", maximum: "5000", step: "1" },
  { unit: "litre", minimum: "0.1", maximum: "50", step: "0.001" },
  { unit: "ml", minimum: "1", maximum: "5000", step: "1" },
  { unit: "piece", minimum: "1", maximum: "100", step: "1" },
  { unit: "pack", minimum: "1", maximum: "50", step: "1" },
  { unit: "dozen", minimum: "0.5", maximum: "20", step: "0.5" },
]

/** TEST labels only: the official B-17 block list has not been supplied and none is invented. */
export const TEST_BLOCKS = ["Test Block A", "Test Block B"]

export interface GroceryReply {
  status: number
  body?: unknown
}

export interface GroceryViewer {
  /** Stable per account. */
  key: string
  emailVerified: boolean
}

interface StoredOrder {
  owner: string
  detail: GroceryOrderDetailDto
}

const ok = (data: unknown, status = 200): GroceryReply => ({ status, body: { data } })
const fail = (status: number, code: string, details: { field: string; code: string }[] = []): GroceryReply => ({
  status,
  body: {
    error: {
      code,
      message: `server text for ${code}`,
      ...(details.length ? { details: details.map((d) => ({ ...d, message: d.code })) } : {}),
      requestId: "req-grocery",
    },
  },
})

const FINAL: GroceryStatusDto[] = ["delivered", "cancelled"]
const ITEM_KEYS = ["name", "unit", "quantity", "preferredBrand", "substitution", "note"]
const DELIVERY_KEYS = ["contactName", "contactPhone", "block", "addressLine", "landmark"]

export class GroceryBackend {
  enabled = true
  /** Outside opening hours. */
  closed = false
  /** Today's capacity is used up. */
  full = false
  blocks = [...TEST_BLOCKS]
  maxItems = 50
  maxActive = 2
  /** Availability answers this instead (a server or network fault is injected by the transport). */
  availabilityFails: number | null = null
  readonly orders: StoredOrder[] = []
  private readonly keys = new Map<string, { hash: string; id: string }>()
  private serial = 0
  private time = Date.parse("2026-11-27T07:00:00Z")

  availability(): GroceryAvailabilityDto {
    const reason = !this.enabled
      ? "disabled"
      : this.blocks.length === 0
        ? "no_service_area"
        : this.closed
          ? "closed"
          : this.full
            ? "daily_limit_reached"
            : undefined
    return {
      acceptingOrders: reason === undefined,
      ...(reason ? { unavailableReason: reason } : {}),
      serviceableBlocks: [...this.blocks],
      schedule: { timezone: "Asia/Karachi", operatingDays: [1, 2, 3, 4, 5, 6, 7], opensAt: "10:00", closesAt: "20:00" },
      limits: { maxItemsPerOrder: this.maxItems, maxActiveOrders: this.maxActive },
      units: UNIT_RULES,
      substitutionOptions: ["allow", "ask", "none"],
    }
  }

  private stamp(): string {
    this.time += 60_000
    return new Date(this.time).toISOString()
  }

  private find(id: string): StoredOrder | undefined {
    return this.orders.find((order) => order.detail.id === id)
  }

  private summary(order: GroceryOrderDetailDto): GroceryOrderSummaryDto {
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      revision: order.revision,
      itemCount: order.itemCount,
      block: order.block,
      submittedAt: order.submittedAt,
      ...(order.cancelledAt ? { cancelledAt: order.cancelledAt } : {}),
      ...(order.finalAmountDuePaisa !== undefined ? { finalAmountDuePaisa: order.finalAmountDuePaisa } : {}),
      ...(order.deliveredAt ? { deliveredAt: order.deliveredAt } : {}),
    }
  }

  private read(order: StoredOrder): GroceryOrderDetailDto {
    return JSON.parse(JSON.stringify(order.detail)) as GroceryOrderDetailDto
  }

  /** A new submitted order, as the server stores it. */
  create(owner: string, payload: GroceryOrderCreateDto): GroceryOrderDetailDto {
    this.serial += 1
    const at = this.stamp()
    const items: GroceryItemDto[] = payload.items.map((item, index) => ({ position: index + 1, ...item }))
    const detail: GroceryOrderDetailDto = {
      id: `22222222-2222-4222-8222-${String(this.serial).padStart(12, "0")}`,
      reference: `GRC-TEST${String(this.serial).padStart(4, "0")}`,
      status: "submitted",
      revision: 1,
      itemCount: items.length,
      block: payload.delivery.block,
      submittedAt: at,
      items,
      delivery: { ...payload.delivery },
      ...(payload.instructions ? { instructions: payload.instructions } : {}),
      agreements: [],
      canCancel: true,
      history: [{ toStatus: "submitted", actorRole: "customer", createdAt: at }],
      updatedAt: at,
    }
    this.orders.push({ owner, detail })
    return JSON.parse(JSON.stringify(detail)) as GroceryOrderDetailDto
  }

  /** A simple order of `owner`, for tests that start from an existing order. */
  seed(owner: string, overrides: Partial<GroceryOrderCreateDto> = {}): GroceryOrderDetailDto {
    return this.create(owner, {
      items: [
        { name: "Basmati rice", unit: "kg", quantity: "5", preferredBrand: "Any good brand", substitution: "ask" },
        { name: "Eggs", unit: "dozen", quantity: "1.5", substitution: "none" },
      ],
      delivery: {
        contactName: "Ayesha Khan",
        contactPhone: "+923001234567",
        block: TEST_BLOCKS[0],
        addressLine: "House 17, Street 4",
        landmark: "Blue gate",
      },
      ...overrides,
    })
  }

  // -- what staff do (through their own API) ------------------------------------------------------

  private change(id: string, status: GroceryStatusDto | null, apply: (order: GroceryOrderDetailDto, at: string) => void): void {
    const found = this.find(id)
    if (!found) throw new Error(`no grocery order ${id}`)
    const order = found.detail
    const at = this.stamp()
    if (status && status !== order.status) {
      const row: GroceryHistoryDto = { fromStatus: order.status, toStatus: status, actorRole: "staff", createdAt: at }
      order.history.push(row)
      order.status = status
    }
    apply(order, at)
    order.revision += 1
    order.updatedAt = at
    order.canCancel = order.status === "submitted"
  }

  private record(order: GroceryOrderDetailDto, at: string, items: number, service: number, delivery: number): void {
    const total = items + service + delivery
    const agreement: GroceryAgreementDto = {
      sequence: order.agreements.length + 1,
      itemsSubtotalPaisa: items,
      serviceFeePaisa: service,
      deliveryFeePaisa: delivery,
      totalPaisa: total,
      method: "phone_call",
      recordedBy: "staff",
      recordedAt: at,
    }
    order.agreements.push(agreement)
    order.agreedTotalPaisa = total
    order.finalAmountDuePaisa = total
    order.payment = { method: "cash_on_delivery", status: "due", amountDuePaisa: total }
  }

  staffConfirm(id: string, items = 185_000, service = 10_000, delivery = 15_000): void {
    this.change(id, "confirmed", (order, at) => this.record(order, at, items, service, delivery))
  }

  staffReconfirm(id: string, items: number, service: number, delivery: number): void {
    this.change(id, null, (order, at) => this.record(order, at, items, service, delivery))
  }

  staffReduce(id: string, finalPaisa: number): void {
    this.change(id, null, (order) => {
      order.finalAmountDuePaisa = finalPaisa
      order.payment = { method: "cash_on_delivery", status: "due", amountDuePaisa: finalPaisa }
    })
  }

  staffMove(id: string, status: "preparing" | "out_for_delivery"): void {
    this.change(id, status, () => {})
  }

  staffDeliver(id: string): void {
    this.change(id, "delivered", (order, at) => {
      const due = order.finalAmountDuePaisa ?? 0
      order.deliveredAt = at
      order.payment = { method: "cash_on_delivery", status: "collected", amountDuePaisa: due, amountCollectedPaisa: due, collectedAt: at }
    })
  }

  staffCancel(id: string): void {
    this.change(id, "cancelled", (order, at) => {
      order.cancelledAt = at
      order.cancelledBy = "staff"
      delete order.payment
    })
  }

  // -- the routes ---------------------------------------------------------------------------------

  /** `null` when the path is not a Grocery path. `viewer` is `null` when nobody is signed in. */
  route(
    method: string,
    path: string,
    query: URLSearchParams,
    body: unknown,
    idempotencyKey: string | null,
    viewer: GroceryViewer | null
  ): GroceryReply | null {
    if (!path.startsWith("/grocery/")) return null
    if (path === "/grocery/availability" && method === "GET") {
      return this.availabilityFails ? fail(this.availabilityFails, "grocery_unavailable") : ok(this.availability())
    }
    if (!viewer) return fail(401, "unauthenticated")
    if (!viewer.emailVerified) return fail(403, "email_not_verified")

    if (path === "/grocery/orders" && method === "GET") {
      const status = query.get("status")
      const mine = this.orders
        .filter((order) => order.owner === viewer.key && (!status || order.detail.status === status))
        .map((order) => this.summary(order.detail))
        .reverse()
      const limit = Number(query.get("limit") ?? 12)
      const offset = Number(query.get("offset") ?? 0)
      return { status: 200, body: { data: mine.slice(offset, offset + limit), meta: { total: mine.length, limit, offset } } }
    }
    if (path === "/grocery/orders" && method === "POST") return this.submit(viewer, body, idempotencyKey)

    const match = /^\/grocery\/orders\/([^/]+)(\/cancel)?$/.exec(path)
    if (!match) return fail(404, "not_found")
    const found = this.find(decodeURIComponent(match[1]))
    if (!found || found.owner !== viewer.key) return fail(404, "not_found")
    if (!match[2] && method === "GET") return ok(this.read(found))
    if (match[2] && method === "POST") {
      const { revision, reason } = (body ?? {}) as { revision?: number; reason?: string }
      if (found.detail.status !== "submitted") return fail(409, "invalid_state_transition")
      if (revision !== found.detail.revision) return fail(409, "order_conflict", [{ field: "revision", code: "stale_revision" }])
      const at = this.stamp()
      const order = found.detail
      order.history.push({
        fromStatus: "submitted",
        toStatus: "cancelled",
        actorRole: "customer",
        ...(reason ? { reason } : {}),
        createdAt: at,
      })
      Object.assign(order, {
        status: "cancelled",
        cancelledAt: at,
        cancelledBy: "customer",
        ...(reason ? { cancelReason: reason } : {}),
        canCancel: false,
        revision: order.revision + 1,
        updatedAt: at,
      })
      return ok(this.read(found))
    }
    return fail(405, "method_not_allowed")
  }

  private submit(viewer: GroceryViewer, body: unknown, key: string | null): GroceryReply {
    const payload = body as GroceryOrderCreateDto
    const problems: { field: string; code: string }[] = []
    const extra = Object.keys(payload ?? {}).filter((name) => !["items", "delivery", "instructions"].includes(name))
    extra.forEach((field) => problems.push({ field, code: "not_allowed" }))
    payload?.items?.forEach((item, index) => {
      Object.keys(item)
        .filter((name) => !ITEM_KEYS.includes(name))
        .forEach((name) => problems.push({ field: `items.${index}.${name}`, code: "not_allowed" }))
      if (typeof item.quantity !== "string") problems.push({ field: `items.${index}.quantity`, code: "invalid_type" })
    })
    Object.keys(payload?.delivery ?? {})
      .filter((name) => !DELIVERY_KEYS.includes(name))
      .forEach((name) => problems.push({ field: `delivery.${name}`, code: "not_allowed" }))
    if (!payload?.delivery?.contactPhone?.replace(/[\s-]/g, "").match(/^(\+92|0)[0-9]{9,10}$/)) {
      problems.push({ field: "delivery.contactPhone", code: "invalid_phone" })
    }
    if (!payload?.items?.length) problems.push({ field: "items", code: "too_short" })
    if (problems.length) return fail(422, "validation_error", problems)
    if (!key) return fail(400, "idempotency_key_required")
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return fail(400, "idempotency_key_invalid")

    const bound = `${viewer.key}|${key}`
    const hash = JSON.stringify(payload)
    const existing = this.keys.get(bound)
    if (existing) {
      if (existing.hash !== hash) return fail(409, "idempotency_key_reused")
      return ok(this.read(this.find(existing.id)!), 200)
    }
    if (!this.enabled || this.blocks.length === 0) return fail(503, "grocery_unavailable")
    if (this.closed) return fail(409, "grocery_closed")
    const settings: { field: string; code: string }[] = []
    if (payload.items.length > this.maxItems) settings.push({ field: "items", code: "too_many_items" })
    if (!this.blocks.includes(payload.delivery.block)) settings.push({ field: "delivery.block", code: "not_serviceable" })
    if (settings.length) return fail(422, "validation_error", settings)
    const active = this.orders.filter((o) => o.owner === viewer.key && !FINAL.includes(o.detail.status)).length
    if (active >= this.maxActive) return fail(409, "grocery_active_order_limit")
    if (this.full) return fail(409, "grocery_capacity_reached")

    const order = this.create(viewer.key, payload)
    this.keys.set(bound, { hash, id: order.id })
    return ok(order, 201)
  }
}
