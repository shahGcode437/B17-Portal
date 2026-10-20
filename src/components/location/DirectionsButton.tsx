import { Navigation } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { directionsUrlFor } from "@/components/location/directions"
import type { PublicLocation } from "@/types/location"

interface DirectionsButtonProps {
  location: PublicLocation | undefined
  /** The listing's name, so the link says what it navigates to. */
  name: string
  className?: string
}

/**
 * "Get Directions": an external Google Maps link (no SDK, no API key). Rendered only for an exact
 * public point — see `directionsUrlFor`. Opens in a new tab with `noopener noreferrer`.
 */
function DirectionsButton({ location, name, className }: DirectionsButtonProps) {
  const href = directionsUrlFor(location)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11", className)}
    >
      <Navigation aria-hidden="true" />
      Get Directions
      <span className="sr-only"> to {name} (opens Google Maps in a new tab)</span>
    </a>
  )
}

export { DirectionsButton }
