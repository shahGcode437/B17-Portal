import { formatClock, formatClosing, formatDays, formatPaisa } from "@/features/grocery/format"
import { MAX_FIELD_PAISA, paisaToInput, parsePkr } from "@/features/grocery-staff/money"
import { PAYMENT_METHOD_NAME } from "@/features/grocery/paymentCopy"
import type { GroceryPaymentMethodDto } from "@/lib/api/dto/grocery"
import type { GrocerySettingsDto, GrocerySettingsField, GrocerySettingsPatchDto } from "@/lib/api/dto/grocerySettings"

/**
 * The settings form, as pure rules. The bounds below are the API's fixed field rules
 * (`GrocerySettingsPatch`); the server stays the authority and decides every save again.
 */
export const LIMITS = {
  dailyCapacity: { min: 1, max: 200 },
  maxItemsPerOrder: { min: 1, max: 100 },
  maxActiveOrdersPerCustomer: { min: 1, max: 10 },
  /** Rs 1 to Rs 1,000,000. */
  maxOrderValuePaisa: { min: 100, max: MAX_FIELD_PAISA },
  blocks: 100,
  blockLength: 40,
} as const

/** Every method, in the server's order. Cash can't be switched off. */
export const PAYMENT_METHODS: GroceryPaymentMethodDto[] = ["cash_on_delivery", "card", "bank_transfer", "easypaisa", "jazzcash"]

const orderedMethods = (methods: GroceryPaymentMethodDto[]) =>
  PAYMENT_METHODS.filter((method) => method === "cash_on_delivery" || methods.includes(method))

/** The one time zone the server supports. It is shown, never edited. */
export const SUPPORTED_TIMEZONE = "Asia/Karachi"

export interface SettingsDraft {
  enabled: boolean
  serviceableBlocks: string[]
  operatingDays: number[]
  opensAt: string
  closesAt: string
  dailyCapacity: string
  /** Rupees, as typed. */
  maxOrderValue: string
  maxActiveOrdersPerCustomer: string
  maxItemsPerOrder: string
  coversAllB17: boolean
  paymentMethods: GroceryPaymentMethodDto[]
}

export type DraftKey = keyof SettingsDraft

/** The draft key that edits each API field. */
const DRAFT_KEY: Record<GrocerySettingsField, DraftKey> = {
  enabled: "enabled",
  serviceableBlocks: "serviceableBlocks",
  coversAllB17: "coversAllB17",
  operatingDays: "operatingDays",
  opensAt: "opensAt",
  closesAt: "closesAt",
  dailyCapacity: "dailyCapacity",
  maxOrderValuePaisa: "maxOrderValue",
  maxActiveOrdersPerCustomer: "maxActiveOrdersPerCustomer",
  maxItemsPerOrder: "maxItemsPerOrder",
  paymentMethods: "paymentMethods",
}

/** In the order the form shows them. */
export const SETTING_FIELDS = Object.keys(DRAFT_KEY) as GrocerySettingsField[]

export const FIELD_LABEL: Record<GrocerySettingsField, string> = {
  enabled: "Grocery ordering",
  serviceableBlocks: "Delivery blocks",
  coversAllB17: "All of B-17 confirmation",
  operatingDays: "Operating days",
  opensAt: "Opens at",
  closesAt: "Closes at",
  dailyCapacity: "Orders per day",
  maxOrderValuePaisa: "Largest order total",
  maxActiveOrdersPerCustomer: "Open orders per customer",
  maxItemsPerOrder: "Items per order",
  paymentMethods: "Payment methods",
}

export function draftOf(settings: GrocerySettingsDto): SettingsDraft {
  return {
    enabled: settings.enabled,
    serviceableBlocks: [...settings.serviceableBlocks],
    operatingDays: [...settings.operatingDays].sort((a, b) => a - b),
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    dailyCapacity: String(settings.dailyCapacity),
    maxOrderValue: paisaToInput(settings.maxOrderValuePaisa),
    maxActiveOrdersPerCustomer: String(settings.maxActiveOrdersPerCustomer),
    maxItemsPerOrder: String(settings.maxItemsPerOrder),
    coversAllB17: settings.coversAllB17,
    paymentMethods: orderedMethods(settings.paymentMethods),
  }
}

const collapseSpaces = (text: string) => text.trim().split(/\s+/).join(" ")
const blockKey = (text: string) => collapseSpaces(text).toLocaleLowerCase("en")
// Letters and numbers of any script, spaces, "-", "/" and "."; it starts with a letter or number.
const BLOCK = /^[\p{L}\p{N}][\p{L}\p{N} \-/.]*$/u

/** The same list, whatever the order, spacing or capitals (the server's rule). */
export function sameBlocks(a: string[], b: string[]): boolean {
  const keys = (blocks: string[]) => JSON.stringify(blocks.map(blockKey).sort())
  return keys(a) === keys(b)
}

/**
 * The block list and the confirmation that goes with it. "All of B-17" is a statement about one
 * list: a different list is unconfirmed until someone ticks it again. Going back to the saved list
 * brings back what was saved.
 */
export function withBlocks(
  serviceableBlocks: string[],
  saved: Pick<GrocerySettingsDto, "serviceableBlocks" | "coversAllB17">
): Pick<SettingsDraft, "serviceableBlocks" | "coversAllB17"> {
  return { serviceableBlocks, coversAllB17: sameBlocks(serviceableBlocks, saved.serviceableBlocks) && saved.coversAllB17 }
}

/** What is wrong with a new block label, or the label as it will be stored. */
export function checkBlock(text: string, existing: string[]): { ok: true; label: string } | { ok: false; message: string } {
  const label = collapseSpaces(text)
  if (!label) return { ok: false, message: "Type the block's name." }
  if (label.length > LIMITS.blockLength) return { ok: false, message: `A block name can be up to ${LIMITS.blockLength} characters.` }
  if (!BLOCK.test(label)) {
    return { ok: false, message: 'Use letters, numbers, spaces, "-", "/" or ".", starting with a letter or number.' }
  }
  if (existing.some((block) => blockKey(block) === blockKey(label))) return { ok: false, message: "That block is already listed." }
  if (existing.length >= LIMITS.blocks) return { ok: false, message: `At most ${LIMITS.blocks} blocks can be listed.` }
  return { ok: true, label }
}

function wholeNumber(text: string, { min, max }: { min: number; max: number }): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null
  const value = Number(text.trim())
  return value >= min && value <= max ? value : null
}

export type SettingsProblems = Partial<Record<DraftKey, string>>

type Values = Pick<GrocerySettingsDto, GrocerySettingsField>

/**
 * The API's rule. As a CLOSING time `00:00` is midnight at the end of the day, so it is after every
 * opening time except `00:00` itself: a whole day can't be saved that way.
 */
export function closesAfterOpening(opensAt: string, closesAt: string): boolean {
  return closesAt === "00:00" ? opensAt !== "00:00" : closesAt > opensAt
}

/** The draft as API values, with what is wrong. A field with a problem has no value. */
export function parseDraft(draft: SettingsDraft): { values: Partial<Values>; problems: SettingsProblems } {
  const problems: SettingsProblems = {}
  const values: Partial<Values> = {
    enabled: draft.enabled,
    serviceableBlocks: draft.serviceableBlocks,
    paymentMethods: orderedMethods(draft.paymentMethods),
  }

  if (draft.coversAllB17 && draft.serviceableBlocks.length === 0) {
    problems.coversAllB17 = "List the blocks before confirming they cover all of B-17."
  } else values.coversAllB17 = draft.coversAllB17

  if (draft.operatingDays.length === 0) problems.operatingDays = "Choose at least one day."
  else values.operatingDays = [...draft.operatingDays].sort((a, b) => a - b)

  const clock = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!clock.test(draft.opensAt)) problems.opensAt = "Enter the opening time."
  else values.opensAt = draft.opensAt
  if (!clock.test(draft.closesAt)) problems.closesAt = "Enter the closing time."
  else if (clock.test(draft.opensAt) && !closesAfterOpening(draft.opensAt, draft.closesAt)) {
    problems.closesAt =
      "The closing time must be after the opening time. To close at midnight enter 12:00 AM. Hours can't run past midnight."
  } else values.closesAt = draft.closesAt

  for (const key of ["dailyCapacity", "maxItemsPerOrder", "maxActiveOrdersPerCustomer"] as const) {
    const bound = LIMITS[key]
    const value = wholeNumber(draft[key], bound)
    if (value === null) problems[key] = `Enter a whole number from ${bound.min} to ${bound.max}.`
    else values[key] = value
  }

  const amount = parsePkr(draft.maxOrderValue)
  const range = LIMITS.maxOrderValuePaisa
  if (!amount.ok || amount.paisa < range.min || amount.paisa > range.max) {
    problems.maxOrderValue = `Enter rupees from ${formatPaisa(range.min)} to ${formatPaisa(range.max)}, with at most two decimals.`
  } else values.maxOrderValuePaisa = amount.paisa

  return { values, problems }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The fields whose draft differs from the saved version. A field that can't be read counts as changed. */
export function changedFields(saved: GrocerySettingsDto, draft: SettingsDraft): GrocerySettingsField[] {
  const { values } = parseDraft(draft)
  const original = draftOf(saved)
  return SETTING_FIELDS.filter((field) => {
    const key = DRAFT_KEY[field]
    if (same(draft[key], original[key])) return false
    const value = values[field]
    const before = field === "operatingDays" ? original.operatingDays : saved[field]
    return value === undefined || !same(value, before)
  })
}

/** The body of the change: the version it was made from and ONLY the changed fields. */
export function patchOf(saved: GrocerySettingsDto, draft: SettingsDraft): GrocerySettingsPatchDto {
  const { values } = parseDraft(draft)
  const patch: GrocerySettingsPatchDto = { revision: saved.revision }
  for (const field of changedFields(saved, draft)) {
    Object.assign(patch, { [field]: values[field] })
  }
  // The server drops the confirmation when the list changes, unless it is made again in the same
  // change: so a ticked box over a new list is sent even though its value didn't change.
  if (draft.coversAllB17 && patch.serviceableBlocks && !sameBlocks(patch.serviceableBlocks, saved.serviceableBlocks)) {
    patch.coversAllB17 = true
  }
  return patch
}

export function describeValue(field: GrocerySettingsField, value: Values[GrocerySettingsField]): string {
  switch (field) {
    case "enabled":
      return value ? "On" : "Off"
    case "serviceableBlocks": {
      const blocks = value as string[]
      return blocks.length ? blocks.join(", ") : "None"
    }
    case "coversAllB17":
      return value ? "Confirmed" : "Not confirmed"
    case "paymentMethods":
      return (value as GroceryPaymentMethodDto[]).map((method) => PAYMENT_METHOD_NAME[method]).join(", ")
    case "operatingDays":
      return formatDays(value as number[])
    case "opensAt":
      return formatClock(value as string)
    case "closesAt":
      return formatClosing(value as string)
    case "maxOrderValuePaisa":
      return formatPaisa(value as number)
    default:
      return String(value)
  }
}

/** What the draft would show for one field, even while it cannot be read. */
export function describeDraft(field: GrocerySettingsField, draft: SettingsDraft): string {
  const value = parseDraft(draft).values[field]
  return value === undefined ? String(draft[DRAFT_KEY[field]]) || "(empty)" : describeValue(field, value)
}

/**
 * What saving would mean, in the server's own rules (`docs/backend/API_CONTRACT.md` §18–§19): a
 * change affects what is accepted from now on. Existing orders are kept and staff can still handle
 * them; the one limit that also reaches them is the largest total, checked at every new agreement.
 */
export function consequences(saved: GrocerySettingsDto, patch: GrocerySettingsPatchDto): string[] {
  const after = { ...saved, ...patch }
  const notes: string[] = []
  if (patch.enabled === true) {
    notes.push("New orders can be accepted: during opening hours, for listed blocks, while the day has places left.")
  }
  if (patch.enabled === false) {
    notes.push("No new order will be accepted. Existing orders stay, and staff can still handle them.")
  }
  if (after.enabled && after.serviceableBlocks.length === 0) {
    notes.push("No delivery block is listed, so customers still can't order.")
  }
  if (patch.serviceableBlocks) {
    const removed = saved.serviceableBlocks.filter((block) => !patch.serviceableBlocks!.includes(block))
    if (removed.length) {
      notes.push(`New orders for ${removed.join(", ")} will be refused. Existing orders keep their block.`)
    }
  }
  if (patch.coversAllB17 === true) {
    notes.push(
      "Customers will be told you deliver across all sectors and blocks of B-17. They can still only choose a listed block, so check that every block is listed."
    )
  } else if (saved.coversAllB17 && (patch.coversAllB17 === false || (patch.serviceableBlocks && !sameBlocks(patch.serviceableBlocks, saved.serviceableBlocks)))) {
    notes.push("The all-of-B-17 statement is removed: customers see the listed blocks instead.")
  }
  if (patch.paymentMethods) {
    const named = (methods: GroceryPaymentMethodDto[]) => methods.map((method) => PAYMENT_METHOD_NAME[method]).join(", ")
    const added = patch.paymentMethods.filter((method) => !saved.paymentMethods.includes(method))
    const removed = saved.paymentMethods.filter((method) => !patch.paymentMethods!.includes(method))
    if (added.length) {
      notes.push(
        `Customers will be offered ${named(added)}. Switch a method on only when the business account or card machine for it is ready.`
      )
    }
    if (removed.length) {
      notes.push(`${named(removed)} will no longer be offered or recorded. Payments already recorded are kept.`)
    }
  }
  if (patch.operatingDays || patch.opensAt || patch.closesAt) {
    notes.push("The new days and hours decide when new orders are accepted.")
  }
  if (patch.maxOrderValuePaisa !== undefined) {
    notes.push(
      "The largest total applies to every agreement recorded from now on, including for orders that already exist. Totals already recorded don't change."
    )
  }
  if (patch.dailyCapacity !== undefined || patch.maxItemsPerOrder !== undefined || patch.maxActiveOrdersPerCustomer !== undefined) {
    notes.push("Order limits apply to orders sent from now on.")
  }
  return notes
}

export interface Rebased {
  draft: SettingsDraft
  /** Fields BOTH sides changed: keeping the edit replaces the other person's value. */
  clashes: GrocerySettingsField[]
}

/**
 * Someone else saved a newer version while edits were open. This puts the edited fields, and only
 * those, on top of the newer version: every other field shows what is saved now. It sends nothing.
 */
export function rebase(base: GrocerySettingsDto, draft: SettingsDraft, newer: GrocerySettingsDto): Rebased {
  const mine = changedFields(base, draft)
  const theirs = new Set(changedFields(base, draftOf(newer)))
  const next = draftOf(newer)
  for (const field of mine) {
    const key = DRAFT_KEY[field]
    Object.assign(next, { [key]: draft[key] })
  }
  // A tick made over one list never confirms another: it has to be given again for what is shown.
  if (next.coversAllB17 && !sameBlocks(next.serviceableBlocks, draft.serviceableBlocks)) {
    next.coversAllB17 = withBlocks(next.serviceableBlocks, newer).coversAllB17
  }
  const stillDiffers = new Set(changedFields(newer, next))
  return { draft: next, clashes: mine.filter((field) => theirs.has(field) && stillDiffers.has(field)) }
}

export function draftKeyOf(field: GrocerySettingsField): DraftKey {
  return DRAFT_KEY[field]
}
