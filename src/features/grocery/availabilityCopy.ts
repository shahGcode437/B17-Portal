import { formatClock, timeZoneLabel } from "@/features/grocery/format"
import type { GroceryAvailabilityDto } from "@/lib/api/dto/grocery"

export interface AvailabilityMessage {
  tone: "open" | "wait" | "off"
  title: string
  description: string
  showHours: boolean
}

export function availabilityMessage(availability: GroceryAvailabilityDto): AvailabilityMessage {
  const { schedule } = availability
  if (availability.acceptingOrders) {
    return {
      tone: "open",
      title: "Accepting orders now",
      description: `Send your list before ${formatClock(schedule.closesAt)} (${timeZoneLabel(schedule.timezone)}).`,
      showHours: true,
    }
  }
  switch (availability.unavailableReason) {
    case "closed":
      return {
        tone: "wait",
        title: "Closed right now",
        description: "Orders can only be sent during opening hours.",
        showHours: true,
      }
    case "daily_limit_reached":
      return {
        tone: "wait",
        title: "Today's order places are full",
        description: "No more orders can be accepted today. Try again on the next opening day.",
        showHours: true,
      }
    case "no_service_area":
      return {
        tone: "off",
        title: "Grocery ordering is switched off",
        description: "No delivery areas are set up, so orders can't be placed.",
        showHours: false,
      }
    default:
      return {
        tone: "off",
        title: "Grocery ordering is switched off",
        description: "New orders aren't being accepted.",
        showHours: false,
      }
  }
}

/** Whether a customer may start or continue writing an order: closed or full is only "not right now". */
export function canWriteAnOrder(availability: GroceryAvailabilityDto): boolean {
  return (
    availability.acceptingOrders ||
    availability.unavailableReason === "closed" ||
    availability.unavailableReason === "daily_limit_reached"
  )
}
