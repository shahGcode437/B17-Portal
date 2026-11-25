/**
 * Listing CONTACT numbers in the browser (Listing Contact v1) — the one place the app parses, checks,
 * formats or links to a phone number. It mirrors `backend/app/core/phone.py`, field for field and
 * rule for rule, so the form tells a person what is wrong BEFORE a submit instead of letting the
 * API answer `422 invalid_phone`; the server stays the authority.
 *
 * Canonical form (what the API stores and returns): E.164 — `+923001234567`.
 * What a person may type: the national and international forms, with any spaces, dashes, dots,
 * slashes or brackets (`03001234567`, `0300 123 4567`, `+92 300 1234567`, `923001234567`,
 * `0092 3001234567`, `051 1234567`). Nothing is guessed: unreadable input is refused, never
 * repaired.
 *
 * `DEFAULT_COUNTRY_CODE` / `NATIONAL_LENGTHS` are the only Pakistan-specific knowledge, exactly as
 * on the server, so another country is a table entry rather than a new parser.
 */

/** The country a national (leading-zero) number belongs to, without the `+`. */
const DEFAULT_COUNTRY_CODE = "92"
/** Length of the national significant number per country code, where we can state it (PK: 9 or 10). */
const NATIONAL_LENGTHS: Record<string, number[]> = { "92": [9, 10] }
/** Longest raw input accepted (`+92 (300) 123-4567` with room to spare); the API caps it the same. */
export const MAX_PHONE_LENGTH = 24

const SEPARATORS = /[\s\-.()[\]/\u00a0\u2013\u2014]/g
/** E.164: a non-zero country-code digit, then 7 to 14 more digits. */
const E164 = /^[1-9][0-9]{7,14}$/

/** What a person should type, shown under the field and in the validation message. */
export const PHONE_EXAMPLE = "03001234567"
export const PHONE_MESSAGE = `Enter a valid phone number, for example ${PHONE_EXAMPLE} or +92${PHONE_EXAMPLE.slice(1)}.`

/** `raw` as E.164 (`+923001234567`), or `null` when it cannot be read as a phone number. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null
  // The cap is applied to the RAW text, exactly as `app.core.phone.normalize_phone` does, so this
  // function and its server twin answer identically for every input, not just realistic ones.
  if (raw.length > MAX_PHONE_LENGTH) return null
  const compact = raw.trim().replace(SEPARATORS, "")
  if (!compact) return null

  let digits: string
  if (compact.startsWith("+")) digits = compact.slice(1)
  else if (compact.startsWith("00")) digits = compact.slice(2)
  else if (compact.startsWith("0")) digits = DEFAULT_COUNTRY_CODE + compact.slice(1)
  else digits = compact
  if (!/^[0-9]+$/.test(digits) || !E164.test(digits)) return null

  for (const [code, lengths] of Object.entries(NATIONAL_LENGTHS)) {
    if (digits.startsWith(code)) {
      if (!lengths.includes(digits.length - code.length)) return null
      break
    }
  }
  return `+${digits}`
}

/** Whether a stored value is a canonical number — the gate every `tel:` / `wa.me` link passes through. */
export function isNormalizedPhone(value: string | undefined | null): value is string {
  return typeof value === "string" && /^\+[1-9][0-9]{7,14}$/.test(value)
}

/** What is wrong with a typed number, or `null`. `required: false` allows an empty field. */
export function phoneProblem(raw: string | undefined, { required }: { required: boolean }): string | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return required ? "Please enter a contact number." : null
  return normalizePhone(trimmed) === null ? PHONE_MESSAGE : null
}

/**
 * A stored E.164 number as a reader of B-17 Portal expects to see it: a Pakistani number in its
 * familiar national form (`0300 1234567`, `051 1234567`), anything else as the E.164 it is.
 * Never used to build a link — `telHref` / `whatsappHref` read the canonical value.
 */
export function formatPhone(value: string): string {
  if (!isNormalizedPhone(value)) return value
  const digits = value.slice(1)
  if (!digits.startsWith(DEFAULT_COUNTRY_CODE)) return value
  const national = digits.slice(DEFAULT_COUNTRY_CODE.length)
  if (!NATIONAL_LENGTHS[DEFAULT_COUNTRY_CODE]?.includes(national.length)) return value
  // A Pakistani mobile is written `03xx xxxxxxx`; a landline is its two-digit area code and then
  // the number (`051 2345678`, `021 12345678`). The leading 3 is what tells them apart.
  const groupAfter = national.startsWith("3") ? 3 : 2
  return `0${national.slice(0, groupAfter)} ${national.slice(groupAfter)}`
}

/**
 * `tel:` for a canonical number, or `null`. Returning `null` (rather than a best-effort string) is
 * deliberate: a caller renders no button at all instead of one that dials something unintended, and
 * a value that never passed the parser can never reach a link.
 */
export function telHref(value: string | undefined | null): string | null {
  return isNormalizedPhone(value) ? `tel:${value}` : null
}

/** `https://wa.me/<digits>` for a canonical number, or `null`. wa.me takes digits only, no `+`. */
export function whatsappHref(value: string | undefined | null): string | null {
  return isNormalizedPhone(value) ? `https://wa.me/${value.slice(1)}` : null
}
