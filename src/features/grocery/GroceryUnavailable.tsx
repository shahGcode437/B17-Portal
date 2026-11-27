import { useNavigate } from "react-router-dom"
import { PauseCircle } from "lucide-react"
import { EmptyState } from "@/components/feedback/EmptyState"
import { availabilityMessage } from "@/features/grocery/availabilityCopy"
import { routes } from "@/config/routes"
import type { GroceryAvailabilityDto } from "@/lib/api/dto/grocery"

/** New orders are switched off: say so, and keep the way to existing orders. */
function GroceryUnavailable({ availability, keptItems }: { availability: GroceryAvailabilityDto; keptItems: number }) {
  const navigate = useNavigate()
  const message = availabilityMessage(availability)
  const kept = keptItems > 0 ? " Your list stays in this tab for now." : ""
  return (
    <EmptyState
      icon={PauseCircle}
      title={message.title}
      description={`${message.description}${kept}`}
      actionLabel="My Grocery Orders"
      onAction={() => navigate(routes.profileGrocery)}
      secondaryActionLabel="About Grocery"
      onSecondaryAction={() => navigate(routes.grocery)}
    />
  )
}

export { GroceryUnavailable }
