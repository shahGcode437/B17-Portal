import { Utensils } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DetailSection } from "@/components/detail/DetailSection"
import { foodServiceLabel } from "@/config/food"
import { serviceIcons } from "@/features/food/foodIcons"
import type { FoodProfile } from "@/types/business"

interface FoodDetailSectionsProps {
  /** The business's name, used for the menu image's alt text. */
  businessName: string
  food: FoodProfile
}

/**
 * The Food & Dining sections of the Business detail page (FD3). Rendered by
 * `BusinessProfilePage` only for `vertical === "food"` — there is no separate
 * Food detail page or route. Informational only: the menu is a discovery
 * aid, with no ordering, quantity, cart or availability language. Every
 * section is omitted when its data is absent (nothing is invented or shown
 * as a placeholder).
 */
function FoodDetailSections({ businessName, food }: FoodDetailSectionsProps) {
  const { serviceOptions, menuHighlights = [], menuImage } = food

  return (
    <>
      {serviceOptions.length > 0 && (
        <DetailSection title="Service options">
          <ul className="flex flex-wrap gap-2">
            {serviceOptions.map((option) => {
              const Icon = serviceIcons[option]
              return (
                <li key={option}>
                  <Badge variant="outline" className="h-auto min-h-7 gap-1.5 whitespace-normal px-2.5 py-1 text-sm font-normal">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {foodServiceLabel(option)}
                  </Badge>
                </li>
              )
            })}
          </ul>
          {serviceOptions.includes("delivery") && (
            <Typography variant="body-sm" className="text-muted-foreground">
              Delivery is arranged directly with the business. B-17 Portal does not currently provide delivery.
            </Typography>
          )}
        </DetailSection>
      )}

      {menuHighlights.length > 0 && (
        <DetailSection title="Menu highlights">
          <Typography variant="body-sm" className="text-muted-foreground">
            A few items this business offers. Prices, where shown, are illustrative demo values.
          </Typography>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {menuHighlights.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Typography as="p" variant="label" className="break-words">
                    {item.name}
                  </Typography>
                  {item.section && (
                    <Typography as="p" variant="caption" className="break-words">
                      {item.section}
                    </Typography>
                  )}
                  {item.description && (
                    <Typography as="p" variant="body-sm" className="mt-0.5 break-words text-muted-foreground">
                      {item.description}
                    </Typography>
                  )}
                </div>
                {item.price && (
                  <Typography as="p" variant="label" className="max-w-[45%] shrink-0 break-words text-right">
                    {item.price}
                  </Typography>
                )}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {menuImage && (
        <DetailSection title="Menu">
          <CardImage
            src={menuImage}
            icon={Utensils}
            label={`${businessName} menu`}
            tone="accent"
            className="aspect-auto max-h-[32rem] bg-muted object-contain"
          />
        </DetailSection>
      )}
    </>
  )
}

export { FoodDetailSections }
