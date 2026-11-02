import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface PlaceholderImageProps extends React.ComponentProps<"div"> {
  icon: LucideIcon
  label: string
  tone?: "primary" | "accent"
  /** "hero" is the larger, captioned treatment for detail-page cover regions; "card" (default) is the compact icon used in card grids. */
  size?: "card" | "hero"
  /** The image only decorates text that already names the thing (e.g. a card title right beside it): hide it from assistive tech. */
  decorative?: boolean
}

/**
 * Local, dependency-free placeholder for imagery. No media upload exists yet (Phase 13A), so most listings
 * have no photo: this is the common state, and it is an honest one: a tinted field with the listing type's
 * icon, and on detail pages the explicit caption "No photo available". It never pretends to be a photo.
 */
function PlaceholderImage({
  icon: Icon,
  label,
  tone = "primary",
  size = "card",
  decorative = false,
  className,
  ...props
}: PlaceholderImageProps) {
  return (
    <div
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `No photo available for ${label}` })}
      className={cn(
        "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg",
        tone === "primary"
          ? "bg-gradient-to-br from-accent via-accent/80 to-secondary text-accent-foreground"
          : "bg-gradient-to-br from-secondary via-secondary/80 to-accent/70 text-muted-foreground",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="grid-lines absolute inset-0 opacity-50" />
      <span aria-hidden="true" className="glow-field absolute inset-0" />
      {size === "hero" ? (
        <div className="relative flex flex-col items-center gap-3 px-6 text-center">
          <span className="glass-3 flex size-20 items-center justify-center rounded-3xl">
            <Icon className="size-9" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">No photo available</span>
        </div>
      ) : (
        <span className="glass-2 relative flex size-12 max-h-[75%] max-w-[75%] items-center justify-center rounded-2xl">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}

export { PlaceholderImage }
