/**
 * The listing WRITE rules the real API enforces, for the in-memory test server (test helper only, S4).
 *
 * `writeRouter` used to accept anything with a name, so a form could send a value the real backend
 * refuses (an area other than B-17, 21 tags, an over-long price, a `blob:` image, a stray key) and every
 * mock-backed test stayed green. These checks mirror `backend/app/schemas/write.py` (shape, lengths,
 * printable text, strict keys) and `backend/app/services/listing_state.py` (locality, media references)
 * with the SAME error codes and field paths, so the browser suites fail the way the real stack would.
 *
 * Deliberately written from the backend's rules, not imported from the app's own form code: a mock that
 * shared the form's validators would agree with the form by construction and prove nothing.
 *
 * Also enforced here (found against the real stack in Phase 12S S4): `null` clears ONLY `image`, `bedrooms`,
 * `furnished` and the Food `hoursNote` / `menuImage` (anything else is `not_nullable`), the location block's
 * format (`invalid_format`), and a field the stored kind does not have (`not_allowed`: a `food` block on a General
 * business, a `category` on a Food one).
 */
export interface Problem {
  field: string
  code: string
  message?: string
}

/** `LOCALITIES` default (`backend/app/core/config.py`). */
export const LOCALITIES = ["B-17"]
/** The Free plan's cap on pending + approved listings (`backend/app/services/entitlements.py`). */
export const FREE_ACTIVE_LISTING_LIMIT = 3

const MAX_TAGS = 20
const MAX_TAG_LENGTH = 40
/** Python `str.isprintable()`: no control, format or separator characters except the plain space. */
const UNPRINTABLE_ONE_LINE = /(?! )[\p{C}\p{Z}]/u
const UNPRINTABLE_TEXT = /(?![ \n\r\t])[\p{C}\p{Z}]/u

interface TextRule {
  min?: number
  max: number
  /** A description may hold line breaks and tabs; everything else is one line. */
  multiline?: boolean
}

function checkText(problems: Problem[], field: string, value: unknown, rule: TextRule, optional = false): void {
  if (value === undefined || value === null) {
    if (!optional) problems.push({ field, code: "missing" })
    return
  }
  if (typeof value !== "string") {
    problems.push({ field, code: "string_type" })
    return
  }
  const text = value.trim()
  if (text.length < (rule.min ?? 0)) problems.push({ field, code: "string_too_short" })
  else if (text.length > rule.max) problems.push({ field, code: "string_too_long" })
  else if ((rule.multiline ? UNPRINTABLE_TEXT : UNPRINTABLE_ONE_LINE).test(text)) problems.push({ field, code: "invalid_characters" })
}

/** `is_valid_media_reference`: a public https:// address or a site-relative path; nothing else. */
export function isValidMediaReference(value: string): boolean {
  if (!value || !/^[^\s]+$/u.test(value) || UNPRINTABLE_ONE_LINE.test(value)) return false
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\") && !value.split("/").includes("..")
  if (!/^https:\/\/[^/?#]/i.test(value) || value.includes("\\")) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname !== "" && !url.host.includes("@") && url.username === "" && url.password === ""
  } catch {
    return false
  }
}

function checkMedia(problems: Problem[], field: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value !== "string" || value.length > 2048) {
    problems.push({ field, code: typeof value === "string" ? "string_too_long" : "string_type" })
  } else if (value.trim() !== "" && !isValidMediaReference(value.trim())) {
    problems.push({ field, code: "invalid_media_reference" })
  }
}

/** The configured spelling of an area (trimmed, whitespace-collapsed, case-insensitive), or null. */
export function canonicalLocality(area: string): string | null {
  const wanted = area.split(/\s+/u).filter(Boolean).join(" ").toLowerCase()
  return LOCALITIES.find((locality) => locality.toLowerCase() === wanted) ?? null
}

const COMMON_KEYS = ["area", "description", "tags", "image", "location"]
const KIND_KEYS: Record<string, string[]> = {
  provider: ["name", "category"],
  business: ["name", "vertical", "category", "food"],
  tutor: ["name", "category", "grade"],
  property: ["title", "listingType", "propertyType", "price", "bedrooms", "furnished"],
}

/** A key the model does not declare is `not_allowed` - set, null or empty (API_CONTRACT §10.1). */
function checkKeys(problems: Problem[], kind: string, body: Record<string, unknown>, mode: "create" | "patch"): void {
  const allowed = new Set([...COMMON_KEYS, ...(KIND_KEYS[kind] ?? []), ...(mode === "create" ? ["kind"] : ["revision"])])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) problems.push({ field: key, code: "not_allowed", message: "This field cannot be set by the client." })
  }
}

/** `null` clears ONLY these top-level fields (API_CONTRACT §10.3); every other `null` is `not_nullable`. */
const CLEARABLE = new Set(["image", "bedrooms", "furnished"])
/** ... and, inside a Food patch, only these. */
const FOOD_CLEARABLE = new Set(["hoursNote", "menuImage"])

function checkNulls(problems: Problem[], body: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(body)) {
    if (value === null && !CLEARABLE.has(field)) problems.push({ field, code: "not_nullable", message: "This field cannot be cleared." })
  }
  const food = body.food
  if (typeof food === "object" && food !== null) {
    for (const [field, value] of Object.entries(food as Record<string, unknown>)) {
      if (value === null && !FOOD_CLEARABLE.has(field)) problems.push({ field: `food.${field}`, code: "not_nullable", message: "This field cannot be cleared." })
    }
  }
}

function checkTags(problems: Problem[], tags: unknown): void {
  if (tags === undefined) return
  if (!Array.isArray(tags)) {
    problems.push({ field: "tags", code: "list_type" })
    return
  }
  if (tags.length > MAX_TAGS) problems.push({ field: "tags", code: "too_long" })
  tags.forEach((tag, index) => checkText(problems, `tags.${index}`, tag, { max: MAX_TAG_LENGTH }))
}

/** `validate_location`'s block rule (LOCATION_MAP §4): a letter or digit first, then letters, digits, space, `- / .`. */
const BLOCK_FORMAT = /^[\p{L}\p{N}][\p{L}\p{N} \-/.]*$/u

function checkLocationText(problems: Problem[], location: unknown): void {
  if (typeof location !== "object" || location === null) return
  const loc = location as Record<string, unknown>
  checkText(problems, "location.block", loc.block, { max: 40 }, true)
  if (typeof loc.block === "string" && loc.block.trim() !== "" && loc.block.trim().length <= 40 && !BLOCK_FORMAT.test(loc.block.trim())) {
    problems.push({ field: "location.block", code: "invalid_format", message: "Use letters, numbers, spaces, '-', '/' or '.' (up to 40 characters)." })
  }
  checkText(problems, "location.address", loc.address, { max: 200 }, true)
  checkText(problems, "location.landmark", loc.landmark, { max: 100 }, true)
}

function checkFood(problems: Problem[], food: unknown): void {
  if (typeof food !== "object" || food === null) return
  const block = food as Record<string, unknown>
  checkText(problems, "food.hoursNote", block.hoursNote, { max: 80 }, true)
  checkMedia(problems, "food.menuImage", block.menuImage)
  if (Array.isArray(block.categories) && block.categories.length > 20) problems.push({ field: "food.categories", code: "too_long" })
  if (Array.isArray(block.menuHighlights)) {
    if (block.menuHighlights.length > 50) problems.push({ field: "food.menuHighlights", code: "too_long" })
    block.menuHighlights.forEach((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>
      const at = `food.menuHighlights.${index}`
      checkText(problems, `${at}.name`, row.name, { min: 1, max: 60 })
      checkText(problems, `${at}.section`, row.section, { max: 40 }, true)
      checkText(problems, `${at}.description`, row.description, { max: 120 }, true)
      checkText(problems, `${at}.price`, row.price, { max: 24 }, true)
    })
  }
}

/**
 * Everything the request MODEL checks (shape, lengths, printable text, strict keys) plus the locality
 * rule. `mode: "patch"` only checks the fields that are present, like the backend (omitted = unchanged).
 */
export function validateListingBody(
  kind: string,
  body: Record<string, unknown>,
  mode: "create" | "patch",
  /** The stored listing, for a PATCH: which side of a business (General / Food) the fields must belong to. */
  stored?: { vertical?: string }
): Problem[] {
  const problems: Problem[] = []
  checkKeys(problems, kind, body, mode)
  if (mode === "patch") checkNulls(problems, body)
  if (kind === "business") {
    // A field the stored kind does not have is `not_allowed`: `food` on a General business, `category` on a Food one.
    const vertical = (body.vertical as string | undefined) ?? stored?.vertical
    if (vertical === "general" && body.food !== undefined && body.food !== null) problems.push({ field: "food", code: "not_allowed", message: "This listing has no Food profile." })
    if (vertical === "food" && body.category !== undefined && body.category !== null) problems.push({ field: "category", code: "not_allowed", message: "A Food listing takes its categories from the Food block." })
  }
  const need = mode === "create"
  const present = (key: string) => need || body[key] !== undefined

  if (kind === "property") {
    if (present("title")) checkText(problems, "title", body.title, { min: 2, max: 100 })
    if (present("price")) checkText(problems, "price", body.price, { min: 1, max: 40 })
    if (body.bedrooms !== undefined && body.bedrooms !== null) {
      const n = body.bedrooms
      if (typeof n !== "number" || !Number.isInteger(n)) problems.push({ field: "bedrooms", code: "int_type" })
      else if (n < 0) problems.push({ field: "bedrooms", code: "greater_than_equal" })
      else if (n > 30) problems.push({ field: "bedrooms", code: "less_than_equal" })
    }
  } else if (present("name")) {
    checkText(problems, "name", body.name, { min: 2, max: 80 })
  }
  if (kind === "tutor" && present("grade")) checkText(problems, "grade", body.grade, { min: 1, max: 60 })

  if (present("description")) checkText(problems, "description", body.description, { min: 20, max: 400, multiline: true })
  if (present("area")) {
    checkText(problems, "area", body.area, { min: 1, max: 100 })
    if (typeof body.area === "string" && body.area.trim() !== "" && canonicalLocality(body.area) === null) {
      problems.push({ field: "area", code: "unknown_locality", message: `Choose one of: ${LOCALITIES.join(", ")}.` })
    }
  }
  checkTags(problems, body.tags)
  checkMedia(problems, "image", body.image)
  checkLocationText(problems, body.location)
  if (kind === "business") checkFood(problems, body.food)
  return problems
}

/** Does a Free-plan owner with `active` pending + approved listings have room for one more? */
export function hasListingRoom(planCode: "free" | "premium" | undefined, active: number): boolean {
  return (planCode ?? "free") === "premium" || active < FREE_ACTIVE_LISTING_LIMIT
}

// -- service requests (`backend/app/schemas/requests.py`, `services/request_writes.py`) ------------------------------

const REQUEST_KEYS = ["providerListingId", "service", "details", "area", "preferredDate", "preferredTime", "notes", "preferredContactChannel"]
const CONTACT_CHANNELS = ["in_app", "whatsapp", "phone"]
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What `ServiceRequestCreate` checks: strict keys, `service` 1-80 and `area` 2-80 on one line, `details` 10-500 and
 * `notes` <= 500 (line breaks allowed), `preferredDate` as `YYYY-MM-DD`, `preferredTime` as `HH:MM`, the contact
 * preference an enum - then, for a well-formed date, the service's window: today to 365 days ahead (`in_the_past` /
 * `too_far_ahead`). All problems are reported together, like the API. Which listing may be asked, how often and by
 * whom is the router's (it needs the state).
 */
export function validateRequestBody(body: Record<string, unknown>, now: Date = new Date()): Problem[] {
  const problems: Problem[] = []
  for (const key of Object.keys(body)) {
    if (!REQUEST_KEYS.includes(key)) problems.push({ field: key, code: "not_allowed", message: "This field cannot be set by the client." })
  }
  checkText(problems, "service", body.service, { min: 1, max: 80 })
  checkText(problems, "details", body.details, { min: 10, max: 500, multiline: true })
  checkText(problems, "area", body.area, { min: 2, max: 80 })
  checkText(problems, "notes", body.notes, { max: 500, multiline: true }, true)

  const date = body.preferredDate
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push({ field: "preferredDate", code: date === undefined ? "missing" : "invalid_date", message: "Use a calendar date written as YYYY-MM-DD." })
  } else {
    const today = now.toISOString().slice(0, 10)
    const limit = new Date(now.getTime() + 365 * DAY_MS).toISOString().slice(0, 10)
    if (date < today) problems.push({ field: "preferredDate", code: "in_the_past", message: "Choose today or a later date." })
    else if (date > limit) problems.push({ field: "preferredDate", code: "too_far_ahead", message: "Choose a date within the next 365 days." })
  }
  const time = body.preferredTime
  if (time !== undefined && time !== null && (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    problems.push({ field: "preferredTime", code: "invalid_time", message: "Use a 24-hour time written as HH:MM." })
  }
  const channel = body.preferredContactChannel
  if (channel !== undefined && !CONTACT_CHANNELS.includes(String(channel))) problems.push({ field: "preferredContactChannel", code: "enum" })
  return problems
}
