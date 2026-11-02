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
  /** Overlay chips (type, Featured, For Sale...) — top-left. */
  badges?: ReactNode
  /** Overlay action (Save) — top-right. */
  action?: ReactNode
  /**
   * "banner" (listing detail pages): a wide cover that the identity panel overlaps, 4:3 on phones, 16:9 on
   * tablets and 5:2 from `lg`. "inline" (default; an article cover inside a narrow column): 4:3 / 16:9.
   */
  variant?: "banner" | "inline"
}

/**
 * Cover region for detail pages. It is the page's main (above-the-fold) image, so it loads eagerly with high
 * fetch priority; `object-cover` (from CardImage) keeps portrait/landscape/low-quality sources from distorting
 * the layout, and a missing or failed image falls back to the captioned hero placeholder at the same ratio — the
 * region never collapses. The frame casts a restrained brand-tinted shadow (its ambient glow); it is a box-shadow,
 * so it can never cause horizontal scroll.
 */
function DetailHero({ src, icon, label, tone, badges, action, variant = "inline" }: DetailHeroProps) {
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-3xl shadow-[0_28px_70px_-28px_color-mix(in_srgb,var(--primary)_45%,transparent)] ring-1 ring-border">
        <CardImage
          src={src}
          icon={icon}
          label={label}
          tone={tone}
          placeholderSize="hero"
          loading="eager"
          fetchPriority="high"
          className={cn(
            "rounded-none",
            variant === "banner" ? "aspect-[4/3] sm:aspect-video lg:aspect-[5/2]" : "aspect-[4/3] sm:aspect-video"
          )}
        />
      </div>
      {badges && <div className="absolute left-3 top-3 flex flex-wrap gap-2">{badges}</div>}
      {action && <div className="absolute right-3 top-3 [&>button]:size-11">{action}</div>}
    </div>
  )
}

export { DetailHero }
