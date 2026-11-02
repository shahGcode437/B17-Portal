import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowUpRight, MapPin } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Card } from "@/components/ui/card"
import { CardPreviewTrigger } from "@/components/cards/CardPreviewTrigger"
import { FeaturedBadge } from "@/components/detail/FeaturedBadge"
import type { CardFact } from "@/components/cards/cardFacts"
import { SaveButton } from "@/components/inputs/SaveButton"
import type { SavedItemKind } from "@/types/resident"

interface ListingCardShellProps {
  kind: SavedItemKind
  id: string
  /** The listing's own name/title: it names the preview and Save controls and the image. */
  name: string
  /** What kind of listing this is ("Service provider", "Business", "Food & Dining", "Tutor"...). */
  typeLabel: string
  typeIcon: LucideIcon
  tone?: "primary" | "accent"
  image?: string
  /** An extra chip over the image (e.g. "For Sale"). Featured is drawn from `featured`, never passed here. */
  imageBadge?: ReactNode
  featured?: boolean
  title: string
  /** Category line under the title. */
  subtitle?: string
  /** A headline value shown above the title (a property's price string). */
  highlight?: string
  description?: string
  facts?: CardFact[]
  area: string
  /** A real action below the content (only Provider has one). */
  footer?: ReactNode
  onSelect?: () => void
}

/**
 * The shared grammar of every listing card (VR3). Provider, Business (general and Food), Tutor and Property
 * differ only in what they pass in: the frame, the type chip, the hierarchy (headline -> title -> category ->
 * description -> facts -> location) and the click affordance are one design, so the five read as a family.
 *
 * Interaction is unchanged from Phase 9M: the card is a plain container, one named "Preview <name>" button is
 * stretched over it (`CardPreviewTrigger`), and Save / a real action sit above it as separate controls. Only
 * real data is rendered: nothing here invents a rating, a response time, an availability or a contact action.
 */
function ListingCardShell({
  kind,
  id,
  name,
  typeLabel,
  typeIcon: TypeIcon,
  tone,
  image,
  imageBadge,
  featured,
  title,
  subtitle,
  highlight,
  description,
  facts = [],
  area,
  footer,
  onSelect,
}: ListingCardShellProps) {
  return (
    <Card
      variant={featured ? "featured" : "interactive"}
      className="group relative isolate h-full gap-0 rounded-2xl p-2 hover:shadow-elevated"
      // Motion adds tabindex=0 to elements with a press gesture; the card container must not be a tab stop (the preview button is).
      tabIndex={-1}
    >
      <CardPreviewTrigger name={name} onSelect={onSelect} />

      <div className="relative overflow-hidden rounded-xl">
        <CardImage
          src={image}
          icon={TypeIcon}
          label={name}
          tone={tone}
          decorative
          className="aspect-[16/10] rounded-none transition-transform duration-500 group-hover:scale-[1.04]"
        />
        {(featured || imageBadge) && (
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {featured && <FeaturedBadge />}
            {imageBadge}
          </div>
        )}
        <SaveButton kind={kind} id={id} name={name} className="absolute right-2 top-2 z-20" />
        <span className="glass-3 absolute bottom-2 left-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground">
          <TypeIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{typeLabel}</span>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-2 pb-2 pt-3">
        <div className="flex flex-col gap-1">
          {highlight && (
            <Typography as="p" variant="label" className="font-heading text-xl font-bold tracking-tight text-primary">
              {highlight}
            </Typography>
          )}
          <Typography as="p" variant="label" className="line-clamp-2 break-words font-heading text-lg font-semibold leading-snug">
            {title}
          </Typography>
          {subtitle && (
            <Typography as="p" variant="body-sm" className="line-clamp-1 font-medium text-primary">
              {subtitle}
            </Typography>
          )}
        </div>

        {description && (
          <Typography as="p" variant="body-sm" className="line-clamp-2 text-muted-foreground">
            {description}
          </Typography>
        )}

        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {facts.map(({ text, icon: FactIcon }) => (
              <li
                key={text}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary/70 px-2.5 py-1 text-[0.8125rem] font-medium leading-tight text-secondary-foreground"
              >
                {FactIcon && <FactIcon className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{text}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{area}</span>
          </span>
          <ArrowUpRight
            className="size-4 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden="true"
          />
        </div>

        {footer && <div className="relative z-20">{footer}</div>}
      </div>
    </Card>
  )
}

export { ListingCardShell }
