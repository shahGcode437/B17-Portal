/**
 * The Grocery STAFF API over the same in-memory orders as the customer fake (test helper only;
 * nothing here ships). It follows `backend/app/services/grocery_staff_orders.py`: the order of
 * refusal (401 / 403 → 429 → 422 body → 404 → own order → holder → state → Super Admin → revision →
 * business rule), the holder rule, the transitions, claim / release not moving the revision, the
 * queue leaving the viewer's own orders out of rows, totals and counts, and what each response
 * carries. It does not model locking, the session-freshness windows (a test injects their answer)
 * or the server's free-text rules. CSRF is the transport's job.
 */
import type { GroceryAgreementDto, GroceryHistoryDto, GroceryStatusDto } from "../../lib/api/dto/grocery"
import type {
  GroceryDeliveryAttemptDto,
  GroceryStaffActionDto,
  GroceryStaffConfirmationDto,
  GroceryStaffEventDto,
  GroceryStaffMemberDto,
  GroceryStaffOrderDetailDto,
  GroceryStaffOrderSummaryDto,
  GroceryStaffPaymentDto,
  GroceryStaffRefundDto,
  GroceryRecordableMethodDto,
} from "../../lib/api/dto/groceryStaff"
import type { GroceryBackend, GroceryReply, StoredOrder } from "./groceryBackend"

export interface StaffViewer {
  /** The account id `/auth/me` reports. */
  id: string
  displayName: string
  /** The key this account's own customer orders are stored under. */
  ownerKey: string
  superAdmin: boolean
  /** A Moderator holding the grocery scope. */
  groceryScope: boolean
  emailVerified: boolean
}

interface StaffRecord {
  assignee?: GroceryStaffMemberDto
  confirmations: GroceryStaffConfirmationDto[]
  events: GroceryStaffEventDto[]
  payment?: GroceryStaffPaymentDto
  refund?: GroceryStaffRefundDto
  /** What only staff see about a history row. */
  rows: WeakMap<GroceryHistoryDto, { actor?: GroceryStaffMemberDto; reason?: string }>
  cancelledAt?: string
}

const STATUSES: GroceryStatusDto[] = ["submitted", "confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"]
const ACTIVE: GroceryStatusDto[] = ["submitted", "confirmed", "preparing", "out_for_delivery"]
const UNKNOWN_MEMBER: GroceryStaffMemberDto = { userId: "33333333-3333-4333-8333-000000000000", displayName: "Another Staffer" }
const MAX_FIELD = 100_000_000

type Problem = { field: string; code: string }

const ok = (data: unknown): GroceryReply => ({ status: 200, body: { data } })
const fail = (status: number, code: string, details: Problem[] = []): GroceryReply => ({
  status,
  body: {
    error: {
      code,
      message: `server text for ${code}`,
      ...(details.length ? { details: details.map((d) => ({ ...d, message: d.code })) } : {}),
      requestId: "req-grocery-staff",
    },
  },
})
const conflict = (code: string) => fail(409, code)
const stale = () => fail(409, "order_conflict", [{ field: "revision", code: "stale_revision" }])
const invalid = (field: string, code: string) => fail(422, "validation_error", [{ field, code }])
const ownOrder = () => fail(403, "forbidden", [{ field: "order", code: "own_order" }])

const AGREEMENT_KEYS = [
  "revision", "itemsSubtotalPaisa", "serviceFeePaisa", "deliveryFeePaisa", "agreedTotalPaisa", "customerAgreed",
  "method", "substitutionsAgreed", "pricingNote", "consentNote",
]
const BODY_KEYS: Record<string, string[]> = {
  claim: [], release: [], confirm: AGREEMENT_KEYS, reconfirm: AGREEMENT_KEYS,
  "reduce-amount": ["revision", "finalAmountPaisa", "reason"],
  "start-preparing": ["revision"], dispatch: ["revision", "note"], "delivery-failed": ["revision", "reason"],
  complete: ["revision", "amountCollectedPaisa"], cancel: ["revision", "reason", "procurementAcknowledged"],
  "record-payment": ["revision", "method", "amountPaisa", "reference", "moneyVerified"],
  refund: ["revision", "amountPaisa", "method", "reference", "reason", "moneyReturned", "procurementAcknowledged"],
  issues: ["kind", "note"],
}

type Body = Record<string, unknown>

const ONLINE = ["bank_transfer", "easypaisa", "jazzcash"]

/** The server's normal form of a reference: no spaces or hyphens, upper case. */
const referenceOf = (value: unknown) => (typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : "")

function referenceProblem(reference: string): string | undefined {
  if (!/^[A-Z0-9/._#]{4,64}$/.test(reference)) return "invalid_reference"
  const digits = /\d{13,19}/.exec(reference)?.[0]
  if (digits) {
    const sum = [...digits].reverse().reduce((total, digit, i) => {
      const doubled = Number(digit) * (i % 2 ? 2 : 1)
      return total + (doubled > 9 ? doubled - 9 : doubled)
    }, 0)
    if (sum % 10 === 0) return "looks_like_card_number"
  }
  return /^PK\d{2}[A-Z]{4}\d{16}$/.test(reference) ? "looks_like_account_number" : undefined
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function bodyProblems(operation: string, body: Body): Problem[] {
  const problems: Problem[] = Object.keys(body)
    .filter((key) => !BODY_KEYS[operation].includes(key))
    .map((field) => ({ field, code: "not_allowed" }))
  const integer = (field: string, minimum: number, required = true) => {
    const value = body[field]
    if (value === undefined) {
      if (required) problems.push({ field, code: "missing" })
      return
    }
    if (!Number.isInteger(value)) problems.push({ field, code: "int_type" })
    else if ((value as number) < minimum || (value as number) > MAX_FIELD) problems.push({ field, code: "out_of_range" })
  }
  const required = (field: string, max: number) => {
    if (!text(body[field])) problems.push({ field, code: body[field] === undefined ? "missing" : "string_too_short" })
    else if (text(body[field]).length > max) problems.push({ field, code: "string_too_long" })
  }
  if (BODY_KEYS[operation].includes("revision")) integer("revision", 1)
  if (operation === "confirm" || operation === "reconfirm") {
    integer("itemsSubtotalPaisa", 1)
    integer("serviceFeePaisa", 0, false)
    integer("deliveryFeePaisa", 0, false)
    integer("agreedTotalPaisa", 1)
    if (body.customerAgreed !== true) problems.push({ field: "customerAgreed", code: "agreement_required" })
    if (!["phone_call", "in_person", "written_message"].includes(String(body.method))) problems.push({ field: "method", code: "enum" })
    if (typeof body.substitutionsAgreed !== "boolean") problems.push({ field: "substitutionsAgreed", code: "missing" })
    if (operation === "reconfirm") required("consentNote", 500)
    else if (body.substitutionsAgreed === true && !text(body.consentNote)) {
      problems.push({ field: "consentNote", code: "substitution_note_required" })
    }
  }
  if (operation === "reduce-amount") {
    integer("finalAmountPaisa", 1)
    required("reason", 200)
  }
  if (operation === "delivery-failed" || operation === "cancel") required("reason", 200)
  if (operation === "complete") integer("amountCollectedPaisa", 1, false)
  if (operation === "record-payment") {
    if (body.method === "cash_on_delivery") problems.push({ field: "method", code: "cash_at_delivery" })
    else if (!["card", ...ONLINE].includes(String(body.method))) problems.push({ field: "method", code: "enum" })
    integer("amountPaisa", 1)
    const wrong = referenceProblem(referenceOf(body.reference))
    if (wrong) problems.push({ field: "reference", code: wrong })
    if (body.moneyVerified !== true) problems.push({ field: "moneyVerified", code: "verification_required" })
  }
  if (operation === "refund") {
    integer("amountPaisa", 1)
    if (!["cash", "card", ...ONLINE].includes(String(body.method))) problems.push({ field: "method", code: "enum" })
    if (referenceOf(body.reference)) {
      const wrong = referenceProblem(referenceOf(body.reference))
      if (wrong) problems.push({ field: "reference", code: wrong })
    } else if (body.method !== "cash") problems.push({ field: "reference", code: "reference_required" })
    required("reason", 200)
    if (body.moneyReturned !== true) problems.push({ field: "moneyReturned", code: "return_required" })
  }
  if (operation === "issues") {
    if (body.kind === "cancelled_after_procurement") problems.push({ field: "kind", code: "system_only" })
    else if (!["payment_discrepancy", "item_shortage", "delivery_problem", "customer_unreachable", "other"].includes(String(body.kind))) {
      problems.push({ field: "kind", code: "enum" })
    }
    required("note", 500)
  }
  return problems
}

export class GroceryStaffBackend {
  /** The largest agreed total allowed (a setting on the server; moderators cannot read it). */
  maxOrderValuePaisa = 2_000_000
  /** Staff writes answer `429`. */
  rateLimited = false
  private readonly records = new WeakMap<StoredOrder, StaffRecord>()

  private readonly store: GroceryBackend

  constructor(store: GroceryBackend) {
    this.store = store
  }

  record(order: StoredOrder): StaffRecord {
    let found = this.records.get(order)
    if (!found) {
      found = { confirmations: [], events: [], rows: new WeakMap() }
      this.records.set(order, found)
    }
    return found
  }

  private stored(id: string): StoredOrder {
    const found = this.store.orders.find((order) => order.detail.id === id)
    if (!found) throw new Error(`no grocery order ${id}`)
    return found
  }

  /** Puts an order in someone's hands without going through the API. */
  assign(id: string, member: GroceryStaffMemberDto | undefined): void {
    this.record(this.stored(id)).assignee = member
  }

  private summary(order: StoredOrder): GroceryStaffOrderSummaryDto {
    const detail = order.detail
    const record = this.record(order)
    return {
      id: detail.id,
      reference: detail.reference,
      status: detail.status,
      revision: detail.revision,
      submittedAt: detail.submittedAt,
      serviceDate: new Date(Date.parse(detail.submittedAt) + 5 * 3_600_000).toISOString().slice(0, 10),
      block: detail.block,
      itemCount: detail.itemCount,
      ...(record.assignee ? { assignee: record.assignee } : {}),
      ...(detail.agreedTotalPaisa !== undefined ? { agreedTotalPaisa: detail.agreedTotalPaisa } : {}),
      ...(detail.finalAmountDuePaisa !== undefined ? { finalAmountDuePaisa: detail.finalAmountDuePaisa } : {}),
      paymentCollected: Boolean(record.payment) && !record.refund,
      ...(this.store.paymentStatusOf(detail) ? { paymentStatus: this.store.paymentStatusOf(detail) } : {}),
      failedDeliveryAttempts: detail.history.filter((r) => r.fromStatus === "out_for_delivery" && r.toStatus === "preparing").length,
      issueCount: record.events.filter((event) => event.action === "issue_recorded").length,
    }
  }

  private recordable(order: StoredOrder): GroceryRecordableMethodDto[] {
    if (this.record(order).payment) return []
    return this.store.paymentMethods.filter((m): m is GroceryRecordableMethodDto => m !== "cash_on_delivery")
  }

  private actions(order: StoredOrder, viewer: StaffViewer): GroceryStaffActionDto[] {
    const status = order.detail.status
    const { assignee, payment: paid, refund: refunded } = this.record(order)
    const active = ACTIVE.includes(status)
    const holder = viewer.superAdmin || assignee?.userId === viewer.id
    const actions: GroceryStaffActionDto[] = []
    if (active && !assignee) actions.push("claim")
    if (active && assignee && holder) actions.push("release")
    if (holder) {
      if (status === "submitted") actions.push("confirm")
      if ((status === "confirmed" || status === "preparing") && !paid) actions.push("reconfirm")
      if (["confirmed", "preparing", "out_for_delivery"].includes(status) && !paid) actions.push("reduce_amount")
      if (status === "confirmed") actions.push("start_preparing")
      if (status === "preparing") actions.push("dispatch")
      if (status === "out_for_delivery") actions.push("delivery_failed", "complete")
      if (!paid && (["submitted", "confirmed"].includes(status) || (status === "preparing" && viewer.superAdmin))) {
        actions.push("cancel")
      }
      if (["confirmed", "preparing", "out_for_delivery"].includes(status) && !paid && this.recordable(order).length) {
        actions.push("record_payment")
      }
      if (viewer.superAdmin && paid && !refunded && ["confirmed", "preparing", "delivered"].includes(status)) {
        actions.push("record_refund")
      }
    }
    actions.push("record_issue")
    return actions
  }

  detail(order: StoredOrder, viewer: StaffViewer): GroceryStaffOrderDetailDto {
    const detail = order.detail
    const record = this.record(order)
    const attempts: GroceryDeliveryAttemptDto[] = []
    for (const row of detail.history) {
      const extra = record.rows.get(row)
      const actor = extra?.actor ?? UNKNOWN_MEMBER
      if (row.toStatus === "out_for_delivery") {
        attempts.push({
          attempt: attempts.length + 1,
          dispatchedBy: actor,
          dispatchedAt: row.createdAt,
          ...(extra?.reason ? { note: extra.reason } : {}),
          outcome: "in_progress",
        })
      } else if (row.fromStatus === "out_for_delivery" && attempts.length) {
        const failed = row.toStatus === "preparing"
        Object.assign(attempts[attempts.length - 1], {
          outcome: failed ? "failed" : "delivered",
          outcomeBy: actor,
          outcomeAt: row.createdAt,
          ...(failed && extra?.reason ? { failureReason: extra.reason } : {}),
        })
      }
    }
    const answer: GroceryStaffOrderDetailDto = {
      ...this.summary(order),
      items: detail.items,
      delivery: detail.delivery,
      ...(detail.instructions ? { instructions: detail.instructions } : {}),
      ...(record.cancelledAt ? { cancelledAt: record.cancelledAt } : {}),
      ...(detail.deliveredAt ? { deliveredAt: detail.deliveredAt } : {}),
      confirmations: record.confirmations,
      ...(record.payment ? { payment: record.payment } : {}),
      ...(record.refund ? { refund: record.refund } : {}),
      recordableMethods: this.recordable(order),
      deliveryAttempts: attempts,
      history: detail.history.map((row) => {
        const extra = record.rows.get(row)
        const reason = row.actorRole === "customer" ? row.reason : extra?.reason
        return {
          ...(row.fromStatus ? { fromStatus: row.fromStatus } : {}),
          toStatus: row.toStatus,
          actorRole: row.actorRole,
          ...(row.actorRole === "staff" ? { actor: extra?.actor ?? UNKNOWN_MEMBER } : {}),
          ...(reason ? { reason } : {}),
          createdAt: row.createdAt,
        }
      }),
      events: record.events,
      availableActions: this.actions(order, viewer),
      updatedAt: detail.updatedAt,
    }
    return JSON.parse(JSON.stringify(answer)) as GroceryStaffOrderDetailDto
  }

  private queue(query: URLSearchParams, viewer: StaffViewer): GroceryReply {
    const assigned = query.get("assigned")
    if (assigned && assigned !== "me" && assigned !== "unassigned" && !/^[0-9a-f-]{36}$/i.test(assigned)) {
      return invalid("assigned", "invalid_assignee")
    }
    const reference = query.get("reference")
    if (reference !== null && (reference.length < 3 || reference.length > 16)) return invalid("reference", "string_too_short")
    const limit = Number(query.get("limit") ?? 12)
    const offset = Number(query.get("offset") ?? 0)
    if (!(limit >= 1 && limit <= 50) || !(offset >= 0 && offset <= 100_000)) return invalid("limit", "out_of_range")
    const prefix = reference ? (reference.toUpperCase().startsWith("GRC-") ? "" : "GRC-") + reference.trim().toUpperCase() : null
    const day = query.get("submittedOn")
    const filtered = this.store.orders
      .filter((order) => order.owner !== viewer.ownerKey)
      .map((order) => this.summary(order))
      .filter(
        (row) =>
          (!prefix || row.reference.startsWith(prefix)) &&
          (!day || row.serviceDate === day) &&
          (!assigned ||
            (assigned === "unassigned" ? !row.assignee : row.assignee?.userId === (assigned === "me" ? viewer.id : assigned)))
      )
    const counts = Object.fromEntries(STATUSES.map((s) => [s, filtered.filter((row) => row.status === s).length]))
    const status = query.get("status")
    const rows = filtered
      .filter((row) => !status || row.status === status)
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) * (query.get("sort") === "newest" ? -1 : 1))
    return {
      status: 200,
      body: { data: JSON.parse(JSON.stringify(rows.slice(offset, offset + limit))), meta: { total: rows.length, limit, offset, counts } },
    }
  }

  /** `null` when the path is not a staff Grocery path. `viewer` is `null` when nobody is signed in. */
  route(method: string, path: string, query: URLSearchParams, body: unknown, viewer: StaffViewer | null): GroceryReply | null {
    if (!path.startsWith("/admin/grocery/orders")) return null
    if (!viewer) return fail(401, "unauthenticated")
    if (!viewer.emailVerified) return fail(403, "email_not_verified")
    if (!viewer.superAdmin && !viewer.groceryScope) return fail(403, "forbidden")
    if (path === "/admin/grocery/orders" && method === "GET") return this.queue(query, viewer)
    const match = /^\/admin\/grocery\/orders\/([^/]+)(?:\/([a-z-]+))?$/.exec(path)
    if (!match) return fail(404, "not_found")
    const found = this.store.orders.find((order) => order.detail.id === decodeURIComponent(match[1]))
    const operation = match[2]
    if (!operation) {
      if (method !== "GET") return fail(405, "method_not_allowed")
      if (!found) return fail(404, "not_found")
      return found.owner === viewer.ownerKey ? ownOrder() : ok(this.detail(found, viewer))
    }
    if (method !== "POST" || !(operation in BODY_KEYS)) return fail(405, "method_not_allowed")
    if (this.rateLimited) return fail(429, "rate_limited")
    const payload = (body ?? {}) as Body
    const problems = bodyProblems(operation, payload)
    if (problems.length) return fail(422, "validation_error", problems)
    if (!found) return fail(404, "not_found")
    if (found.owner === viewer.ownerKey) return ownOrder()
    return this.change(found, operation, payload, viewer) ?? ok(this.detail(found, viewer))
  }

  /** `null`: done. Otherwise the refusal. */
  private change(order: StoredOrder, operation: string, body: Body, viewer: StaffViewer): GroceryReply | null {
    const detail = order.detail
    const record = this.record(order)
    const me: GroceryStaffMemberDto = { userId: viewer.id, displayName: viewer.displayName }
    const status = detail.status
    const holder = viewer.superAdmin || record.assignee?.userId === viewer.id
    const event = (entry: Omit<GroceryStaffEventDto, "actor" | "createdAt">) =>
      record.events.push({ ...entry, actor: me, createdAt: this.store.tick() })

    if (operation === "claim") {
      if (!ACTIVE.includes(status)) return conflict("invalid_state_transition")
      if (record.assignee?.userId === viewer.id) return null
      if (record.assignee) return conflict("order_already_claimed")
      record.assignee = me
      event({ action: "claimed", subject: me })
      return null
    }
    if (operation === "release") {
      if (!ACTIVE.includes(status)) return conflict("invalid_state_transition")
      if (!record.assignee || !holder) return conflict("order_not_claimed")
      event({ action: "released", subject: record.assignee })
      record.assignee = undefined
      return null
    }
    if (operation === "issues") {
      event({ action: "issue_recorded", issueKind: body.kind as GroceryStaffEventDto["issueKind"], note: text(body.note) })
      return null
    }

    if (!holder) return conflict("order_not_claimed")
    const allowed: Record<string, GroceryStatusDto[]> = {
      confirm: ["submitted"],
      reconfirm: ["confirmed", "preparing"],
      "reduce-amount": ["confirmed", "preparing", "out_for_delivery"],
      "start-preparing": ["confirmed"],
      dispatch: ["preparing"],
      "delivery-failed": ["out_for_delivery"],
      complete: ["out_for_delivery"],
      "record-payment": ["confirmed", "preparing", "out_for_delivery"],
      cancel: ["submitted", "confirmed", "preparing"],
    }
    if (operation === "refund") return this.refund(order, body, viewer)
    if (!allowed[operation].includes(status)) return conflict("invalid_state_transition")
    const afterBuying = status === "preparing"
    if (operation === "cancel" && afterBuying && !viewer.superAdmin) {
      return fail(403, "forbidden", [{ field: "order", code: "super_admin_required" }])
    }
    if (body.revision !== detail.revision) return stale()

    const move = (to: GroceryStatusDto, reason?: string) => {
      const row: GroceryHistoryDto = { fromStatus: detail.status, toStatus: to, actorRole: "staff", createdAt: this.store.tick() }
      detail.history.push(row)
      record.rows.set(row, { actor: me, ...(reason ? { reason } : {}) })
      detail.status = to
    }
    const due = detail.finalAmountDuePaisa ?? 0

    if (record.payment && ["reconfirm", "reduce-amount", "cancel", "record-payment"].includes(operation)) {
      return conflict("payment_recorded")
    }

    if (operation === "record-payment") {
      const method = body.method as GroceryRecordableMethodDto
      const reference = referenceOf(body.reference)
      if (!this.store.paymentMethods.includes(method)) return invalid("method", "method_not_enabled")
      if (body.amountPaisa !== due) return invalid("amountPaisa", "amount_mismatch")
      const taken = this.store.orders.some((other) => {
        const payment = this.record(other).payment
        return payment?.method === method && payment.reference === reference
      })
      if (ONLINE.includes(method) && taken) return invalid("reference", "reference_in_use")
      const at = this.store.tick()
      record.payment = { method, amountDuePaisa: due, amountCollectedPaisa: due, reference, collectedBy: me, collectedAt: at }
      detail.payment = { method, status: "collected", amountDuePaisa: due, amountCollectedPaisa: due, collectedAt: at }
    } else if (operation === "confirm" || operation === "reconfirm") {
      const items = body.itemsSubtotalPaisa as number
      const service = (body.serviceFeePaisa as number | undefined) ?? 0
      const delivery = (body.deliveryFeePaisa as number | undefined) ?? 0
      const total = items + service + delivery
      if (body.agreedTotalPaisa !== total) return invalid("agreedTotalPaisa", "total_mismatch")
      if (total > this.maxOrderValuePaisa) return invalid("agreedTotalPaisa", "exceeds_order_limit")
      const at = this.store.tick()
      const sequence = record.confirmations.length + 1
      const method = body.method as GroceryAgreementDto["method"]
      record.confirmations.push({
        sequence,
        itemsSubtotalPaisa: items,
        serviceFeePaisa: service,
        deliveryFeePaisa: delivery,
        totalPaisa: total,
        method,
        substitutionsAgreed: body.substitutionsAgreed as boolean,
        ...(text(body.pricingNote) ? { pricingNote: text(body.pricingNote) } : {}),
        ...(text(body.consentNote) ? { consentNote: text(body.consentNote) } : {}),
        recordedBy: me,
        recordedAt: at,
      })
      detail.agreements.push({
        sequence, itemsSubtotalPaisa: items, serviceFeePaisa: service, deliveryFeePaisa: delivery, totalPaisa: total,
        method, recordedBy: "staff", recordedAt: at,
      })
      detail.agreedTotalPaisa = total
      detail.finalAmountDuePaisa = total
      detail.payment = { method: "cash_on_delivery", status: "due", amountDuePaisa: total }
      if (operation === "confirm") move("confirmed")
    } else if (operation === "reduce-amount") {
      const lower = body.finalAmountPaisa as number
      if (lower >= due) return invalid("finalAmountPaisa", "not_a_reduction")
      event({ action: "amount_reduced", amountBeforePaisa: due, amountAfterPaisa: lower, note: text(body.reason) })
      detail.finalAmountDuePaisa = lower
      detail.payment = { method: "cash_on_delivery", status: "due", amountDuePaisa: lower }
    } else if (operation === "start-preparing") {
      move("preparing")
    } else if (operation === "dispatch") {
      move("out_for_delivery", text(body.note))
    } else if (operation === "delivery-failed") {
      move("preparing", text(body.reason))
    } else if (operation === "complete") {
      const cash = body.amountCollectedPaisa
      if (record.payment && cash !== undefined) return invalid("amountCollectedPaisa", "already_paid")
      if (!record.payment && cash === undefined) return invalid("amountCollectedPaisa", "missing")
      if (!record.payment && cash !== due) return invalid("amountCollectedPaisa", "amount_mismatch")
      const at = this.store.tick()
      if (!record.payment) {
        record.payment = { method: "cash_on_delivery", amountDuePaisa: due, amountCollectedPaisa: due, collectedBy: me, collectedAt: at }
        detail.payment = { method: "cash_on_delivery", status: "collected", amountDuePaisa: due, amountCollectedPaisa: due, collectedAt: at }
      }
      detail.deliveredAt = at
      move("delivered")
    } else if (operation === "cancel") {
      if (afterBuying && body.procurementAcknowledged !== true) return invalid("procurementAcknowledged", "acknowledgement_required")
      move("cancelled", text(body.reason))
      record.cancelledAt = detail.history.at(-1)!.createdAt
      detail.cancelledAt = record.cancelledAt
      detail.cancelledBy = "staff"
      delete detail.payment
      if (afterBuying) event({ action: "issue_recorded", issueKind: "cancelled_after_procurement", note: text(body.reason) })
    }
    detail.revision += 1
    detail.canCancel = detail.status === "submitted"
    detail.updatedAt = this.store.tick()
    return null
  }

  /** The Super Admin's record of a full refund, in the server's order of refusal (§21). */
  private refund(order: StoredOrder, body: Body, viewer: StaffViewer): GroceryReply | null {
    const detail = order.detail
    const record = this.record(order)
    const me: GroceryStaffMemberDto = { userId: viewer.id, displayName: viewer.displayName }
    const status = detail.status
    if (!viewer.superAdmin) return fail(403, "forbidden", [{ field: "order", code: "super_admin_required" }])
    if (!["confirmed", "preparing", "delivered"].includes(status)) return conflict("invalid_state_transition")
    if (body.revision !== detail.revision) return stale()
    if (!record.payment || record.refund) {
      return fail(409, "invalid_state_transition", [{ field: "payment", code: record.refund ? "already_refunded" : "no_payment" }])
    }
    if (body.amountPaisa !== record.payment.amountCollectedPaisa) return invalid("amountPaisa", "amount_mismatch")
    const afterBuying = status === "preparing"
    if (afterBuying && body.procurementAcknowledged !== true) return invalid("procurementAcknowledged", "acknowledgement_required")
    const at = this.store.tick()
    const reference = referenceOf(body.reference)
    record.refund = {
      amountPaisa: record.payment.amountCollectedPaisa,
      method: body.method as GroceryStaffRefundDto["method"],
      ...(reference ? { reference } : {}),
      reason: text(body.reason),
      refundedBy: me,
      refundedAt: at,
    }
    detail.payment = { ...detail.payment!, status: "refunded", refundedAmountPaisa: record.refund.amountPaisa, refundedAt: at }
    if (status !== "delivered") {
      const row: GroceryHistoryDto = { fromStatus: status, toStatus: "cancelled", actorRole: "staff", createdAt: this.store.tick() }
      detail.history.push(row)
      record.rows.set(row, { actor: me, reason: text(body.reason) })
      detail.status = "cancelled"
      record.cancelledAt = row.createdAt
      detail.cancelledAt = row.createdAt
      detail.cancelledBy = "staff"
      if (afterBuying) {
        record.events.push({
          action: "issue_recorded",
          issueKind: "cancelled_after_procurement",
          note: text(body.reason),
          actor: me,
          createdAt: this.store.tick(),
        })
      }
    }
    detail.revision += 1
    detail.canCancel = false
    detail.updatedAt = this.store.tick()
    return null
  }
}
