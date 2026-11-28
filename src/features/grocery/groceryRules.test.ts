import { describe, expect, it } from "vitest"
import { availabilityMessage, canWriteAnOrder } from "@/features/grocery/availabilityCopy"
import { formatClock, formatClosing, formatDays, formatPaisa, formatSchedule } from "@/features/grocery/format"
import { EMPTY_DELIVERY, buildOrderRequest, deliverySchema, itemSchema, type DraftItem } from "@/features/grocery/orderRequest"
import { failedDeliveries, timelineOf } from "@/features/grocery/orderStatus"
import { checkQuantity, formatAmount, fromThousandths, toThousandths } from "@/features/grocery/quantity"
import { userMessageFor } from "@/lib/api/writeErrors"
import { errorFromBody } from "@/lib/api/errors"
import { GroceryBackend, TEST_BLOCKS, UNIT_RULES } from "@/test/fixtures/groceryBackend"
import type { GroceryUnitDto } from "@/lib/api/dto/grocery"

const rule = (unit: GroceryUnitDto) => UNIT_RULES.find((r) => r.unit === unit)!
const check = (text: string, unit: GroceryUnitDto) => checkQuantity(text, rule(unit))

describe("grocery quantities are exact", () => {
  it("reads decimal strings as whole thousandths, with no floating point", () => {
    expect([toThousandths("0.05"), toThousandths("1.5"), toThousandths("50"), toThousandths("0.001")]).toEqual([50, 1500, 50000, 1])
    // 0.1 + 0.2 as floats is 0.30000000000000004; as thousandths it is 300.
    expect(toThousandths("0.1")! + toThousandths("0.2")!).toBe(toThousandths("0.3"))
    expect([fromThousandths(1500), fromThousandths(50000), fromThousandths(1)]).toEqual(["1.5", "50", "0.001"])
  })

  it.each(["", "abc", "1.2345", "-1", "+1", "1e3", "NaN", "Infinity", "1,5", "01", "1.", " ", "0", "0.000"])(
    "refuses %j",
    (text) => {
      expect(check(text, "kg").ok).toBe(false)
    }
  )

  it("applies each unit's minimum, maximum and step exactly", () => {
    expect(check("0.05", "kg")).toEqual({ ok: true, value: "0.05" })
    expect(check("0.049", "kg")).toMatchObject({ ok: false, message: "Use at least 0.05 kg." })
    expect(check("50", "kg").ok).toBe(true)
    expect(check("50.001", "kg")).toMatchObject({ ok: false, message: "Use at most 50 kg." })
    expect(check("0.1", "litre").ok).toBe(true)
    expect(check("1.5", "dozen")).toEqual({ ok: true, value: "1.5" })
    expect(check("1.25", "dozen")).toMatchObject({ ok: false, message: "Use steps of 0.5 dozen." })
    expect(check("1.5", "piece")).toMatchObject({ ok: false, message: "Use a whole number of pieces." })
    expect(check("5000", "gram").ok).toBe(true)
    expect(check("5001", "gram").ok).toBe(false)
  })

  it("writes the canonical form: no trailing zeros, and a leading dot read as zero", () => {
    expect(check("2.500", "kg")).toEqual({ ok: true, value: "2.5" })
    expect(check(" .5 ", "kg")).toEqual({ ok: true, value: "0.5" })
    expect(formatAmount("1", "pack")).toBe("1 pack")
    expect(formatAmount("2", "pack")).toBe("2 packs")
  })
})

describe("grocery money and hours", () => {
  it("formats whole paisa with integers only", () => {
    expect(formatPaisa(210_000)).toBe("Rs 2,100")
    expect(formatPaisa(210_005)).toBe("Rs 2,100.05")
    expect(formatPaisa(99)).toBe("Rs 0.99")
    expect(formatPaisa(2_000_000)).toBe("Rs 20,000")
  })

  it("writes days and times from the server's schedule", () => {
    expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBe("Every day")
    expect(formatDays([1, 2, 3, 4, 5, 6])).toBe("Monday to Saturday")
    expect(formatDays([5, 1])).toBe("Monday, Friday")
    expect([formatClock("10:00"), formatClock("20:30"), formatClock("00:15"), formatClock("12:00")]).toEqual([
      "10:00 AM",
      "8:30 PM",
      "12:15 AM",
      "12:00 PM",
    ])
  })

  it("writes a midnight CLOSING as midnight, and an ordinary one as a time", () => {
    const schedule = { timezone: "Asia/Karachi", operatingDays: [1, 2, 3, 4, 5, 6, 7], opensAt: "08:00", closesAt: "00:00" }
    expect(formatSchedule(schedule)).toBe("Every day — 8:00 AM to 12:00 Midnight (Pakistan time).")
    expect([formatClosing("00:00"), formatClosing("23:59")]).toEqual(["12:00 Midnight", "11:59 PM"])
    expect(formatClock("00:00")).toBe("12:00 AM") // as an opening or a plain time it stays a time
  })

  it("says why ordering is not open, and when a list may still be written", () => {
    const backend = new GroceryBackend()
    const states = () => [availabilityMessage(backend.availability()).title, canWriteAnOrder(backend.availability())]
    expect(states()).toEqual(["Accepting orders now", true])
    backend.closed = true
    expect(states()).toEqual(["Closed right now", true])
    backend.closed = false
    backend.full = true
    expect(states()).toEqual(["Today's order places are full", true])
    backend.blocks = []
    expect(states()).toEqual(["Grocery ordering is switched off", false])
    backend.enabled = false
    expect(states()).toEqual(["Grocery ordering is switched off", false])
  })
})

const ITEM = { name: "  Basmati\trice ", quantity: "5.000", unit: "kg" as const, preferredBrand: "", substitution: "ask" as const, note: "  " }
const DELIVERY = { ...EMPTY_DELIVERY, contactName: " Ayesha Khan ", contactPhone: "0300 123 4567", block: TEST_BLOCKS[0], addressLine: "House 17, Street 4" }

describe("grocery form rules", () => {
  it("checks an item against the server's unit rules and normalizes it", () => {
    const parsed = itemSchema(UNIT_RULES).safeParse(ITEM)
    expect(parsed.success && parsed.data).toMatchObject({ name: "Basmati rice", quantity: "5", note: "" })
    const refused = itemSchema(UNIT_RULES).safeParse({ ...ITEM, name: " ", quantity: "999" })
    expect(refused.success).toBe(false)
    expect(refused.error!.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["name"]))
  })

  it("requires a Pakistani phone and a configured block", () => {
    const schema = deliverySchema(TEST_BLOCKS)
    expect(schema.safeParse(DELIVERY).success).toBe(true)
    const bad = schema.safeParse({ ...DELIVERY, contactPhone: "+44 20 7946 0958", block: "Block Z", addressLine: "H1" })
    expect(bad.error!.issues.map((i) => i.path[0])).toEqual(["contactPhone", "block", "addressLine"])
  })

  it("builds exactly the declared request: strings for quantities, E.164 phone, no blank optionals", () => {
    const item: DraftItem = { ...ITEM, quantity: "5", id: "item-1" }
    const request = buildOrderRequest([item], DELIVERY)
    expect(request).toEqual({
      items: [{ name: "Basmati rice", unit: "kg", quantity: "5", substitution: "ask" }],
      delivery: { contactName: "Ayesha Khan", contactPhone: "+923001234567", block: TEST_BLOCKS[0], addressLine: "House 17, Street 4" },
    })
    // the same draft always produces the same body (what an idempotency key is bound to)
    expect(JSON.stringify(buildOrderRequest([item], DELIVERY))).toBe(JSON.stringify(request))
  })
})

describe("grocery status timeline", () => {
  function order(moves: ("preparing" | "out_for_delivery" | "delivered" | "cancelled")[]) {
    const backend = new GroceryBackend()
    const { id } = backend.seed("a")
    backend.staffConfirm(id)
    for (const move of moves) {
      if (move === "delivered") backend.staffDeliver(id)
      else if (move === "cancelled") backend.staffCancel(id)
      else backend.staffMove(id, move)
    }
    return backend.orders[0].detail
  }
  const shape = (o: ReturnType<typeof order>) => timelineOf(o).map((s) => `${s.status}:${s.state}${s.at ? "@" : ""}`)

  it("shows reached, current and upcoming steps, with times only for reached ones", () => {
    expect(shape(order(["preparing"]))).toEqual([
      "submitted:done@",
      "confirmed:done@",
      "preparing:current@",
      "out_for_delivery:upcoming",
      "delivered:upcoming",
    ])
  })

  it("after a failed delivery goes back to preparing without looking further along", () => {
    const failed = order(["preparing", "out_for_delivery", "preparing"])
    expect(failedDeliveries(failed)).toBe(1)
    expect(shape(failed)).toEqual([
      "submitted:done@",
      "confirmed:done@",
      "preparing:current@",
      "out_for_delivery:upcoming",
      "delivered:upcoming",
    ])
    expect(shape(order(["preparing", "out_for_delivery", "preparing", "out_for_delivery", "delivered"]))).toEqual([
      "submitted:done@",
      "confirmed:done@",
      "preparing:done@",
      "out_for_delivery:done@",
      "delivered:current@",
    ])
  })

  it("a cancelled order shows only the steps it reached, then the cancellation", () => {
    expect(shape(order(["preparing", "cancelled"]))).toEqual([
      "submitted:done@",
      "confirmed:done@",
      "preparing:done@",
      "cancelled:current@",
    ])
  })
})

describe("grocery error copy comes from the code, never the server's text", () => {
  const copy = (status: number, code: string, details: unknown[] = []) =>
    userMessageFor(errorFromBody(status, { error: { code, message: "SERVER TEXT", details } }), "grocery-submit")

  it.each([
    [503, "grocery_unavailable", "Grocery ordering isn't available right now"],
    [409, "grocery_closed", "Grocery ordering is closed right now"],
    [409, "grocery_capacity_reached", "Today's grocery order places are full"],
    [409, "grocery_active_order_limit", "You have the most open grocery orders allowed"],
    [409, "idempotency_key_reused", "This order couldn't be matched safely"],
    [429, "rate_limited", "You've sent several grocery orders recently"],
  ])("%s %s", (status, code, title) => {
    const message = copy(status, code)
    expect(message.title).toBe(title)
    expect(message.description).not.toContain("SERVER TEXT")
  })

  it("names the list line a quantity or block problem is on", () => {
    expect(copy(422, "validation_error", [{ field: "items.2.quantity", code: "quantity_too_large" }]).description).toBe(
      "Item 3: The quantity isn't allowed for that unit. Edit the item and check it."
    )
    expect(copy(422, "validation_error", [{ field: "delivery.block", code: "not_serviceable" }]).description).toContain(
      "isn't available in that block"
    )
  })
})
