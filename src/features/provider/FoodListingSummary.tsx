import { Utensils } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { FOOD_VERTICAL_LABEL, foodCategoryLabel, foodServiceLabel } from "@/config/food"
import type { Business } from "@/types/business"

interface FoodListingSummaryProps {
  business: Business
  /** Heading level to fit the surrounding page/dialog outline (2 on a page, 3 inside a dialog). */
  headingLevel?: 2 | 3
}

/**
 * Compact read-only Food & Dining metadata for a submitted Business (FD4):
 * used by the create/edit preview, the Professional "View" dialog and the
 * Admin review panel, so the submitter and the moderator both see the Food
 * data the generic `BusinessCard` does not show. It is a summary, not a menu
 * editor — nothing here is interactive. Renders nothing for a general Business.
 */
function FoodListingSummary({ business, headingLevel = 3 }: FoodListingSummaryProps) {
  const food = business.vertical === "food" ? business.food : undefined
  if (!food) return null

  const menuHighlights = food.menuHighlights ?? []
  const [primary, ...secondary] = food.categories

  return (
    <section aria-labelledby={`food-summary-${business.id}`} className="flex min-w-0 flex-col gap-2">
      <Typography
        as={`h${headingLevel}`}
        variant="label"
        id={`food-summary-${business.id}`}
        className="text-muted-foreground"
      >
        {FOOD_VERTICAL_LABEL} details
      </Typography>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-muted p-3 text-sm">
        <dt className="text-muted-foreground">Categories</dt>
        <dd className="break-words">
          {primary ? (
            <>
              <span className="font-medium">{foodCategoryLabel(primary)}</span> (primary)
              {secondary.length > 0 && <>, {secondary.map(foodCategoryLabel).join(", ")}</>}
            </>
          ) : (
            "None"
          )}
        </dd>
        <dt className="text-muted-foreground">Services</dt>
        <dd className="break-words">
          {food.serviceOptions.length > 0 ? food.serviceOptions.map(foodServiceLabel).join(", ") : "None"}
        </dd>
        <dt className="text-muted-foreground">Hours</dt>
        <dd className="break-words">{food.hoursNote ?? <span className="text-muted-foreground">Not provided</span>}</dd>
        <dt className="text-muted-foreground">Menu highlights</dt>
        <dd className="min-w-0">
          {menuHighlights.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <>
              <span className="font-medium">
                {menuHighlights.length} {menuHighlights.length === 1 ? "item" : "items"}
              </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {menuHighlights.map((item) => (
                  <li key={item.id} className="break-words">
                    {item.name}
                    {item.section && <span className="text-muted-foreground"> · {item.section}</span>}
                    {item.price && <span className="text-muted-foreground"> · {item.price}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">Menu image</dt>
        <dd>{food.menuImage ? "Added" : <span className="text-muted-foreground">None</span>}</dd>
      </dl>
      {food.menuImage && (
        <CardImage
          src={food.menuImage}
          icon={Utensils}
          label={`${business.name} menu`}
          tone="accent"
          className="aspect-auto max-h-48 bg-muted object-contain"
        />
      )}
    </section>
  )
}

export { FoodListingSummary }
