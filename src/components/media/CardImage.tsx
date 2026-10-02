import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { PlaceholderImage } from "@/components/media/PlaceholderImage"
import { cn } from "@/lib/utils"

interface CardImageProps extends React.ComponentProps<"img"> {
  /** Local `/images/...` path. Optional — falls back to PlaceholderImage when absent. */
  src?: string
  icon: LucideIcon
  label: string
  tone?: "primary" | "accent"
  /** Passed to PlaceholderImage — "hero" for detail-page cover regions. */
  placeholderSize?: "card" | "hero"
  className?: string
}

/**
 * Single seam between real demo photos and the icon placeholder. Every card
 * renders images through this component instead of choosing directly, so
 * missing/invalid paths (typo, asset not yet supplied) fail gracefully by
 * falling back to PlaceholderImage rather than a broken image icon.
 */
function CardImage({ src, icon, label, tone, placeholderSize, className, ...imgProps }: CardImageProps) {
  const [failed, setFailed] = React.useState(false)

  if (!src || failed) {
    return <PlaceholderImage icon={icon} label={label} tone={tone} size={placeholderSize} className={className} />
  }

  return (
    <img
      src={src}
      alt={label}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("aspect-video w-full rounded-lg object-cover", className)}
      {...imgProps}
    />
  )
}

export { CardImage }
