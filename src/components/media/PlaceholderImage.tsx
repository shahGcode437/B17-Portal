import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface PlaceholderImageProps extends React.ComponentProps<"div"> {
  icon: LucideIcon
  label: string
  tone?: "primary" | "accent"
}

/**
 * Local, dependency-free placeholder for demo imagery (no client assets
 * exist yet). Swap for a real <img src="/images/..."> once client assets
 * arrive — every card already treats `image` as optional for this reason.
 */
function PlaceholderImage({ icon: Icon, label, tone = "primary", className, ...props }: PlaceholderImageProps) {
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
      <Icon className="size-8 opacity-70" aria-hidden="true" />
    </div>
  )
}

export { PlaceholderImage }
