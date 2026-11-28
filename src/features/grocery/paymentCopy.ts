/**
 * What customers are told about price and payment, in ONE place. Every sentence about HOW to pay is
 * built from the methods the server says are switched on (`paymentMethods`, API_CONTRACT §21), so a
 * method a Super Admin hasn't enabled is never named. No account or wallet number is written here:
 * staff give payment details to the customer directly.
 */
import type { GroceryAvailabilityDto, GroceryPaymentMethodDto } from "@/lib/api/dto/grocery"

const CASH: GroceryPaymentMethodDto = "cash_on_delivery"
const ONLINE: GroceryPaymentMethodDto[] = ["bank_transfer", "easypaisa", "jazzcash"]

export const PAYMENT_METHOD_NAME: Record<GroceryPaymentMethodDto, string> = {
  cash_on_delivery: "Cash on delivery",
  card: "Card",
  bank_transfer: "Bank transfer",
  easypaisa: "Easypaisa",
  jazzcash: "JazzCash",
}

/** "Paid …": how a recorded payment was made. */
export const PAID_BY: Record<GroceryPaymentMethodDto, string> = {
  cash_on_delivery: "in cash",
  card: "by card",
  bank_transfer: "by bank transfer",
  easypaisa: "with Easypaisa",
  jazzcash: "with JazzCash",
}

/** `undefined` while the server hasn't answered. A server before §21 offers cash only. */
export function offeredMethods(availability: GroceryAvailabilityDto | null | undefined): GroceryPaymentMethodDto[] | undefined {
  if (!availability) return undefined
  return availability.paymentMethods?.length ? availability.paymentMethods : [CASH]
}

export const PRICE_CONFIRMED =
  "Your total price, including any applicable delivery or service charges, is confirmed before your order is prepared."

const SUBSTITUTIONS =
  "Items depend on availability: we follow your substitution choice for each one. If the total has to go up, we confirm it with you again."

export interface PaymentCopy {
  /** Only cash is offered. */
  cashOnly: boolean
  /** The last step of "How it works". */
  stepTitle: string
  stepText: string
  /** When and how to pay. */
  howToPay: string
  /** Where no price has been recorded yet. */
  summary: string
  /** What to know about the extra methods. Empty with cash only. */
  notes: string[]
  /** What can still change, and what happens then. */
  ifThingsChange: string
  /** The methods by name, when there is more than cash. */
  methodNames: string[]
}

export function paymentCopy(methods: GroceryPaymentMethodDto[] | undefined): PaymentCopy {
  const card = Boolean(methods?.includes("card"))
  const online = Boolean(methods?.some((method) => ONLINE.includes(method)))

  if (!card && !online) {
    // Cash is always offered, so before the server answers only "you can" is claimed.
    const known = methods !== undefined
    const howToPay = known ? "Pay in cash when your order arrives." : "You can pay in cash when your order arrives."
    return {
      cashOnly: known,
      stepTitle: "Pay on delivery",
      stepText: howToPay,
      howToPay,
      summary: known ? "Payment is cash on delivery." : howToPay,
      notes: [],
      ifThingsChange: SUBSTITUTIONS,
      methodNames: [],
    }
  }

  const kinds = card && online ? "cash, card or online" : card ? "cash or card" : "cash or online"
  const stepText = `Pay using our available ${kinds} payment options.`
  const howToPay = online
    ? "Pay after order confirmation or upon delivery using the available payment options."
    : "Pay in cash or by card when your order arrives."
  return {
    cashOnly: false,
    stepTitle: "Pay your way",
    stepText,
    howToPay,
    summary: howToPay,
    notes: [
      ...(card ? ["Card payments are taken on our team's card machine when your order is delivered."] : []),
      ...(online
        ? [
            "Paying early is optional. Pay only after your total is confirmed, using the details our team gives you. Your order shows as paid once we've checked the money arrived.",
          ]
        : []),
      "Never send anyone your card number, PIN or banking password. B17-Portal doesn't ask for them.",
    ],
    ifThingsChange: `${SUBSTITUTIONS} If we can't supply an order you've already paid for, our team contacts you about cancelling and refunding it.`,
    methodNames: (methods ?? []).map((method) => (method === "card" ? "Card on delivery" : PAYMENT_METHOD_NAME[method])),
  }
}
