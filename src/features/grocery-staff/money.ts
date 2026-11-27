/**
 * Rupees as a person types them ⇄ the API's whole paisa. Done on the DIGITS: no floating-point
 * number is ever multiplied, so `0.29` is 29 paisa and not 28.999…
 */

/** The API's own bound on any single amount field (`rules.MAX_AMOUNT_PAISA`, Rs 1,000,000). It is
 * NOT the configurable largest order, which only the server knows and applies. */
export const MAX_FIELD_PAISA = 100_000_000

export type ParsedAmount = { ok: true; paisa: number } | { ok: false; problem: "empty" | "format" | "too_large" }

// Plain digits, or correctly grouped thousands, then at most two decimals. A comma anywhere else
// (`1,5`) is refused rather than guessed at.
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parsePkr(text: string): ParsedAmount {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, problem: "empty" }
  const match = AMOUNT.exec(trimmed)
  if (!match) return { ok: false, problem: "format" }
  const rupees = match[1].replace(/,/g, "").replace(/^0+(?=\d)/, "")
  if (rupees.length > 7) return { ok: false, problem: "too_large" }
  const paisa = Number(rupees) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
  return paisa > MAX_FIELD_PAISA ? { ok: false, problem: "too_large" } : { ok: true, paisa }
}

/** Paisa as the text of an amount field: `185000` → `"1850"`, `185050` → `"1850.50"`. */
export function paisaToInput(paisa: number): string {
  const rest = paisa % 100
  const rupees = String((paisa - rest) / 100)
  return rest === 0 ? rupees : `${rupees}.${String(rest).padStart(2, "0")}`
}

/** What is wrong with an amount field, or `null`. `allowZero` is for the two fees. */
export function amountProblem(text: string, { allowZero }: { allowZero: boolean }): string | null {
  const parsed = parsePkr(text)
  if (!parsed.ok) {
    if (parsed.problem === "empty") return allowZero ? "Enter an amount, or 0 if there is none." : "Enter an amount."
    if (parsed.problem === "too_large") return "That amount is too large."
    return "Enter rupees as digits, with at most two decimals (for example 1850 or 1850.50)."
  }
  return !allowZero && parsed.paisa === 0 ? "The amount must be more than 0." : null
}
