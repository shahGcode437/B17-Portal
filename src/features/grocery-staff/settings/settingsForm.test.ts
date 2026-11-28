import { describe, expect, it } from "vitest"
import {
  changedFields,
  checkBlock,
  consequences,
  draftOf,
  parseDraft,
  patchOf,
  rebase,
  type SettingsDraft,
} from "@/features/grocery-staff/settings/settingsForm"
import { isStaleSettings, settingsRefusal } from "@/features/grocery-staff/settings/settingsErrors"
import { ApiError } from "@/lib/api/errors"
import { defaultSettings } from "@/test/fixtures/adminBackend"

const saved = defaultSettings()
const draft = (change: Partial<SettingsDraft> = {}): SettingsDraft => ({ ...draftOf(saved), ...change })

describe("block labels", () => {
  it("keeps what was typed, with spaces tidied", () => {
    expect(checkBlock("  Test   Block  A ", [])).toEqual({ ok: true, label: "Test Block A" })
    expect(checkBlock("C-1/2.a", [])).toEqual({ ok: true, label: "C-1/2.a" })
    expect(checkBlock("بلاک ا", [])).toEqual({ ok: true, label: "بلاک ا" })
  })

  it.each([
    ["", /Type the block/],
    ["   ", /Type the block/],
    ["-A", /starting with a letter or number/],
    ["Block_A", /starting with a letter or number/],
    ["Block <b>", /starting with a letter or number/],
    ["x".repeat(41), /up to 40/],
  ])("refuses %j", (text, message) => {
    expect(checkBlock(text, [])).toMatchObject({ ok: false, message: expect.stringMatching(message) })
  })

  it("refuses a repeat in any case or spacing, but does not guess that two names are one", () => {
    expect(checkBlock("test   block a", ["Test Block A"])).toMatchObject({ ok: false })
    expect(checkBlock("A", ["Block A"])).toEqual({ ok: true, label: "A" })
  })

  it("stops at 100", () => {
    const full = Array.from({ length: 100 }, (_, n) => `B${n}`)
    expect(checkBlock("One more", full)).toMatchObject({ ok: false, message: expect.stringMatching(/At most 100/) })
  })
})

describe("the settings draft", () => {
  it("the safe defaults round-trip with nothing changed", () => {
    expect(saved).toMatchObject({ enabled: false, serviceableBlocks: [] })
    expect(parseDraft(draft()).problems).toEqual({})
    expect(changedFields(saved, draft())).toEqual([])
    expect(patchOf(saved, draft())).toEqual({ revision: 1 })
  })

  it.each([
    [{ operatingDays: [] }, "operatingDays", /at least one day/],
    [{ opensAt: "" }, "opensAt", /opening time/],
    [{ closesAt: "" }, "closesAt", /closing time/],
    [{ opensAt: "20:00", closesAt: "20:00" }, "closesAt", /after the opening time/],
    [{ opensAt: "22:00", closesAt: "02:00" }, "closesAt", /past midnight/],
    [{ dailyCapacity: "0" }, "dailyCapacity", /1 to 200/],
    [{ dailyCapacity: "201" }, "dailyCapacity", /1 to 200/],
    [{ dailyCapacity: "2.5" }, "dailyCapacity", /whole number/],
    [{ dailyCapacity: "" }, "dailyCapacity", /whole number/],
    [{ maxItemsPerOrder: "101" }, "maxItemsPerOrder", /1 to 100/],
    [{ maxActiveOrdersPerCustomer: "11" }, "maxActiveOrdersPerCustomer", /1 to 10/],
    [{ maxOrderValue: "0.99" }, "maxOrderValue", /from Rs 1 to Rs 1,000,000/],
    [{ maxOrderValue: "1000000.01" }, "maxOrderValue", /Rs 1,000,000/],
    [{ maxOrderValue: "20.000" }, "maxOrderValue", /two decimals/],
  ] as const)("refuses %j", (change, field, message) => {
    const { problems, values } = parseDraft(draft(change as Partial<SettingsDraft>))
    expect(problems[field as keyof typeof problems]).toMatch(message)
    expect(values).not.toHaveProperty(field === "maxOrderValue" ? "maxOrderValuePaisa" : field)
  })

  it.each([
    ["25000", 2_500_000],
    ["19,999.99", 1_999_999],
    ["1.15", 115],
    ["1000000", 100_000_000],
    ["1", 100],
  ])("turns Rs %s into %i paisa", (text, paisa) => {
    expect(parseDraft(draft({ maxOrderValue: text })).values.maxOrderValuePaisa).toBe(paisa)
  })

  it("sends only what changed, with the version it was made from", () => {
    const edited = draft({ enabled: true, serviceableBlocks: ["Test Block A"], dailyCapacity: "12", maxOrderValue: "25,000.50" })
    expect(patchOf({ ...saved, revision: 7 }, edited)).toEqual({
      revision: 7,
      enabled: true,
      serviceableBlocks: ["Test Block A"],
      dailyCapacity: 12,
      maxOrderValuePaisa: 2_500_050,
    })
    expect(patchOf(saved, edited)).not.toHaveProperty("timezone")
  })

  it("the same value written differently is not a change", () => {
    expect(changedFields(saved, draft({ maxOrderValue: "20,000.00", dailyCapacity: "10" }))).toEqual([])
    expect(changedFields(saved, draft({ operatingDays: [7, 6, 5, 4, 3, 2, 1] }))).toEqual([])
  })
})

describe("what saving means", () => {
  const notes = (change: Parameters<typeof consequences>[1] extends infer P ? Omit<P & object, "revision"> : never, from = saved) =>
    consequences(from, { revision: from.revision, ...change }).join(" | ")

  it("says that existing orders stay, and which limit still reaches them", () => {
    expect(notes({ enabled: false }, { ...saved, enabled: true })).toMatch(/No new order will be accepted\. Existing orders stay/)
    expect(notes({ maxOrderValuePaisa: 100 })).toMatch(/including for orders that already exist/)
    expect(notes({ dailyCapacity: 1 })).toBe("Order limits apply to orders sent from now on.")
  })

  it("warns that switching on with no block still lets nobody order", () => {
    expect(notes({ enabled: true })).toMatch(/No delivery block is listed, so customers still can't order/)
    expect(notes({ enabled: true, serviceableBlocks: ["Test Block A"] })).not.toMatch(/No delivery block/)
  })

  it("names the blocks being removed", () => {
    const from = { ...saved, serviceableBlocks: ["Test Block A", "Test Block B"] }
    expect(notes({ serviceableBlocks: ["Test Block B"] }, from)).toMatch(/New orders for Test Block A will be refused/)
  })
})

describe("when someone else saved a newer version", () => {
  const newer = { ...saved, revision: 2, dailyCapacity: 30, opensAt: "09:00" }

  it("puts only my edits on top of theirs, and points out the fields we both changed", () => {
    const mine = draft({ dailyCapacity: "15", maxItemsPerOrder: "20" })
    const result = rebase(saved, mine, newer)
    expect(result.draft).toEqual({ ...draftOf(newer), dailyCapacity: "15", maxItemsPerOrder: "20" })
    expect(result.clashes).toEqual(["dailyCapacity"])
    expect(patchOf(newer, result.draft)).toEqual({ revision: 2, dailyCapacity: 15, maxItemsPerOrder: 20 })
  })

  it("never carries a field I did not touch back over their value", () => {
    const result = rebase(saved, draft({ maxItemsPerOrder: "20" }), newer)
    expect(patchOf(newer, result.draft)).toEqual({ revision: 2, maxItemsPerOrder: 20 })
  })

  it("finds nothing left to save when theirs already holds my values", () => {
    const result = rebase(saved, draft({ dailyCapacity: "30" }), newer)
    expect(changedFields(newer, result.draft)).toEqual([])
    expect(result.clashes).toEqual([])
  })
})

describe("settings refusals", () => {
  const error = (status: number, code: string, details: { field?: string; code?: string }[] = []) =>
    new ApiError({ status, code, message: "RAW SERVER TEXT", details })

  it("recognises a stale version", () => {
    expect(isStaleSettings(error(409, "conflict", [{ field: "revision", code: "stale_revision" }]))).toBe(true)
    expect(isStaleSettings(error(409, "conflict"))).toBe(false)
  })

  it.each([
    [error(422, "validation_error", [{ field: "closesAt", code: "closes_before_opens" }]), /closing time must be after/],
    [error(422, "validation_error", [{ field: "serviceableBlocks", code: "duplicate_block" }]), /more than once/],
    [error(422, "validation_error", [{ field: "dailyCapacity", code: "less_than_equal" }]), /"Orders per day" has a value/],
    [error(422, "validation_error", [{ field: "body", code: "no_changes" }]), /nothing to change/],
    [error(429, "rate_limited"), /Wait a few minutes/],
    [error(403, "csrf_failed"), /nothing was sent again/],
    [error(503, "grocery_unavailable"), /Nothing was saved/],
    [error(418, "what", []), /refused the change/],
  ])("explains %o from its codes only", (refusal, expected) => {
    const copy = settingsRefusal(refusal)
    expect(`${copy.title} ${copy.description}`).toMatch(expected)
    expect(`${copy.title} ${copy.description}`).not.toContain("RAW SERVER TEXT")
  })
})
