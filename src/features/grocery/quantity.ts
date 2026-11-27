import type { GroceryUnitDto, GroceryUnitRuleDto } from "@/lib/api/dto/grocery"

/**
 * Grocery quantities, EXACTLY (API_CONTRACT §18.3). A quantity is a decimal string with at most three
 * places; every comparison here is between whole thousandths, so there is no binary floating point
 * anywhere (`0.1`, `0.05` and a `0.001` step are exact). The limits are never written here: they
 * come from `GET /grocery/availability`, and the server checks them again.
 */

/** The server's own pattern: no sign, exponent, thousands separator or surrounding space. */
const QUANTITY_TEXT = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$/

/** `"1.5"` → `1500`; `null` when the text is not a quantity. */
export function toThousandths(text: string): number | null {
  if (!QUANTITY_TEXT.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"))
}

/** `1500` → `"1.5"`: the canonical text (no trailing zeros), as the server writes it. */
export function fromThousandths(value: number): string {
  const whole = Math.floor(value / 1000)
  const fraction = String(value % 1000).padStart(3, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/** The one convenience: ".5" is read as "0.5". Nothing else is guessed ("1,5" is refused, not repaired). */
function tidy(text: string): string {
  const trimmed = text.trim()
  return trimmed.startsWith(".") ? `0${trimmed}` : trimmed
}

export type QuantityCheck = { ok: true; value: string } | { ok: false; message: string }

export function checkQuantity(text: string, rule: GroceryUnitRuleDto): QuantityCheck {
  const typed = tidy(text)
  if (!typed) return { ok: false, message: "Enter a quantity." }
  const value = toThousandths(typed)
  if (value === null || value === 0) {
    return { ok: false, message: "Enter a number above zero, like 1 or 0.5 (up to 3 decimals)." }
  }
  const minimum = toThousandths(rule.minimum)
  const maximum = toThousandths(rule.maximum)
  const step = toThousandths(rule.step)
  if (minimum !== null && value < minimum) {
    return { ok: false, message: `Use at least ${formatAmount(rule.minimum, rule.unit)}.` }
  }
  if (maximum !== null && value > maximum) {
    return { ok: false, message: `Use at most ${formatAmount(rule.maximum, rule.unit)}.` }
  }
  if (step && value % step !== 0) {
    return {
      ok: false,
      message:
        rule.step === "1"
          ? `Use a whole number of ${UNIT_PLURAL[rule.unit]}.`
          : `Use steps of ${formatAmount(rule.step, rule.unit)}.`,
    }
  }
  return { ok: true, value: fromThousandths(value) }
}

/** What the unit picker shows. */
export const UNIT_LABEL: Record<GroceryUnitDto, string> = {
  kg: "kg",
  gram: "grams",
  litre: "litres",
  ml: "ml",
  piece: "pieces",
  pack: "packs",
  dozen: "dozen",
}

const UNIT_SINGULAR: Record<GroceryUnitDto, string> = {
  kg: "kg",
  gram: "gram",
  litre: "litre",
  ml: "ml",
  piece: "piece",
  pack: "pack",
  dozen: "dozen",
}

const UNIT_PLURAL = UNIT_LABEL

/** `("1", "pack")` → `"1 pack"`, `("2.5", "kg")` → `"2.5 kg"`. */
export function formatAmount(quantity: string, unit: GroceryUnitDto): string {
  return `${quantity} ${quantity === "1" ? UNIT_SINGULAR[unit] : UNIT_PLURAL[unit]}`
}
