import { z } from "zod"
import { MAX_PHONE_LENGTH, normalizePhone } from "@/lib/phone"
import { checkQuantity } from "@/features/grocery/quantity"
import type {
  GroceryDeliveryDto,
  GroceryItemInputDto,
  GroceryOrderCreateDto,
  GrocerySubstitutionDto,
  GroceryUnitDto,
  GroceryUnitRuleDto,
} from "@/lib/api/dto/grocery"

/**
 * The order a customer is writing, and the one place it becomes the body of `POST /grocery/orders`.
 * The text limits mirror `backend/app/schemas/grocery.py`; the server checks everything again, and
 * what depends on its settings (blocks, line limit, units) comes from the availability answer.
 */

export const LIMITS = {
  name: 80,
  brand: 60,
  itemNote: 200,
  contactNameMin: 2,
  contactName: 80,
  addressMin: 5,
  address: 200,
  landmark: 100,
  instructions: 500,
  cancelReason: 200,
} as const

export interface ItemValues {
  name: string
  quantity: string
  unit: GroceryUnitDto
  preferredBrand: string
  substitution: GrocerySubstitutionDto
  note: string
}

export interface DraftItem extends ItemValues {
  /** Client-only row id; never sent. */
  id: string
}

export interface DeliveryValues {
  contactName: string
  contactPhone: string
  block: string
  addressLine: string
  landmark: string
  instructions: string
}

export const EMPTY_DELIVERY: DeliveryValues = {
  contactName: "",
  contactPhone: "",
  block: "",
  addressLine: "",
  landmark: "",
  instructions: "",
}

/** One line of text: pasted tabs and line breaks become spaces (the API refuses control characters). */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
}

function text(max: number, label: string) {
  return z.string().transform(oneLine).pipe(z.string().max(max, `${label} can be up to ${max} characters.`))
}

function requiredText(min: number, max: number, empty: string, label: string) {
  return z
    .string()
    .transform(oneLine)
    .pipe(
      z
        .string()
        .min(1, empty)
        .min(min, `${label} needs at least ${min} characters.`)
        .max(max, `${label} can be up to ${max} characters.`)
    )
}

export function itemSchema(units: GroceryUnitRuleDto[]) {
  return z
    .object({
      name: requiredText(1, LIMITS.name, "Enter what you need.", "The item name"),
      quantity: z.string(),
      unit: z.enum(["kg", "gram", "litre", "ml", "piece", "pack", "dozen"]),
      preferredBrand: text(LIMITS.brand, "The brand"),
      substitution: z.enum(["allow", "ask", "none"]),
      note: text(LIMITS.itemNote, "The instruction"),
    })
    .superRefine((value, context) => {
      const rule = units.find((candidate) => candidate.unit === value.unit)
      if (!rule) {
        context.addIssue({ code: "custom", path: ["unit"], message: "Choose a unit from the list." })
        return
      }
      const checked = checkQuantity(value.quantity, rule)
      if (!checked.ok) context.addIssue({ code: "custom", path: ["quantity"], message: checked.message })
    })
    .transform((value) => {
      const rule = units.find((candidate) => candidate.unit === value.unit)
      const checked = rule ? checkQuantity(value.quantity, rule) : null
      return { ...value, quantity: checked?.ok ? checked.value : value.quantity }
    })
}

export const PHONE_PROBLEM = "Enter a Pakistani phone number, for example 0300 1234567."

/** A Pakistani number in any common spelling, as E.164; `null` otherwise. */
export function pakistaniPhone(value: string): string | null {
  const normalized = normalizePhone(value)
  return normalized?.startsWith("+92") ? normalized : null
}

export function deliverySchema(blocks: string[]) {
  return z.object({
    contactName: requiredText(LIMITS.contactNameMin, LIMITS.contactName, "Enter a contact name.", "The name"),
    contactPhone: z
      .string()
      .max(MAX_PHONE_LENGTH, PHONE_PROBLEM)
      .refine((value) => pakistaniPhone(value) !== null, PHONE_PROBLEM),
    block: z.string().refine((value) => blocks.includes(value), "Choose your block from the list."),
    addressLine: requiredText(LIMITS.addressMin, LIMITS.address, "Enter your house and street.", "The address"),
    landmark: text(LIMITS.landmark, "The landmark"),
    instructions: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(LIMITS.instructions, `Instructions can be up to ${LIMITS.instructions} characters.`)),
  })
}

function toItem(item: ItemValues): GroceryItemInputDto {
  const brand = oneLine(item.preferredBrand)
  const note = oneLine(item.note)
  return {
    name: oneLine(item.name),
    unit: item.unit,
    quantity: item.quantity,
    ...(brand ? { preferredBrand: brand } : {}),
    substitution: item.substitution,
    ...(note ? { note } : {}),
  }
}

/**
 * The exact request body. Blank optional fields are left out, the phone is sent as E.164 and nothing
 * the API does not declare is included — so the same draft always produces the same body, which is
 * what an idempotency key is bound to.
 */
export function buildOrderRequest(items: DraftItem[], delivery: DeliveryValues): GroceryOrderCreateDto {
  const landmark = oneLine(delivery.landmark)
  const instructions = delivery.instructions.trim()
  const address: GroceryDeliveryDto = {
    contactName: oneLine(delivery.contactName),
    contactPhone: pakistaniPhone(delivery.contactPhone) ?? delivery.contactPhone.trim(),
    block: delivery.block,
    addressLine: oneLine(delivery.addressLine),
    ...(landmark ? { landmark } : {}),
  }
  return {
    items: items.map(toItem),
    delivery: address,
    ...(instructions ? { instructions } : {}),
  }
}
