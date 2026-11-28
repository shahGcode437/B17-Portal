/**
 * What customers are told about price and payment, in ONE place. It names only what the service
 * records today: cash, collected on delivery (`GroceryPaymentMethod` in the backend has no other
 * value). When another method is built and switched on, this is what changes, and the screens must
 * then offer only what the server says is available. Never name a method here before that.
 */
export const PAYMENT_COPY = {
  /** The last step of "How it works". */
  stepTitle: "Pay on delivery",
  howToPay: "Pay in cash when your order arrives.",
  priceConfirmed:
    "Your total price, including any applicable delivery or service charges, is confirmed before your order is prepared.",
  /** What can still change, and what happens then. */
  ifThingsChange:
    "Items depend on availability: we follow your substitution choice for each one. If the total has to go up, we confirm it with you again.",
} as const
