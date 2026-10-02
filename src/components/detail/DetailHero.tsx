import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { CardImage } from "@/components/media/CardImage"
import { cn } from "@/lib/utils"

interface DetailHeroProps {
  src?: string
  icon: LucideIcon
  /** Used for the image alt text and the placeholder's accessible label — always the item's own name/title. */
  label: string
  tone?: "primary" | "accent"
  /** Overlay chips (Featured, For Sale…) — top-left. */
  badges?: ReactNode
  /** Overlay action (Save) — top-right. */
  action?: ReactNode
  /** Override the default crop ratio (mobile 4:3, from `sm` 16:9). */
  aspectClassName?: string
}

/**
 * Cover region for detail pages. It is the page's main (above-the-fold)
 * image, so it loads eagerly with high fetch priority; `object-cover` (from
 * CardImage) keeps portrait/landscape/low-quality sources from distorting the
 * layout, and a missing or failed image falls back to the captioned hero
 * placeholder at the same ratio — the region never collapses.
 */
function DetailHero({ src, icon, label, tone, badges, action, aspectClassName }: DetailHeroProps) {
  return (
    <div className="relative">
      <CardImage
        src={src}
        icon={icon}
        label={label}
        tone={tone}
        placeholderSize="hero"
        loading="eager"
        fetchPriority="high"
        className={cn("rounded-2xl shadow-medium", aspectClassName ?? "aspect-[4/3] sm:aspect-video")}
      />
      {badges && <div className="absolute left-3 top-3 flex flex-wrap gap-2">{badges}</div>}
      {action && <div className="absolute right-3 top-3 [&>button]:size-11">{action}</div>}
    </div>
  )
}

export { DetailHero }
