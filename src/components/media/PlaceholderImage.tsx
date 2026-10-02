import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface PlaceholderImageProps extends React.ComponentProps<"div"> {
  icon: LucideIcon
  label: string
  tone?: "primary" | "accent"
  /** "hero" is the larger, captioned treatment for detail-page cover regions; "card" (default) is the compact icon used in card grids. */
  size?: "card" | "hero"
}

/**
 * Local, dependency-free placeholder for demo imagery (no client assets
 * exist yet). Swap for a real <img src="/images/..."> once client assets
 * arrive — every card already treats `image` as optional for this reason.
 */
function PlaceholderImage({
  icon: Icon,
  label,
  tone = "primary",
  size = "card",
  className,
  ...props
}: PlaceholderImageProps) {
  return (
    <div
      role="img"
      aria-label={`Demo image placeholder for ${label}`}
      className={cn(
        "flex aspect-video w-full items-center justify-center rounded-lg",
        tone === "primary" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground",
        className
      )}
      {...props}
    >
      {size === "hero" ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-background/70 shadow-subtle">
            <Icon className="size-8" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">No photo available</span>
        </div>
      ) : (
        <Icon className="size-8 opacity-70" aria-hidden="true" />
      )}
    </div>
  )
}

export { PlaceholderImage }
