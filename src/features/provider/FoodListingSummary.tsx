import { Utensils } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { FOOD_VERTICAL_LABEL, foodCategoryLabel, foodServiceLabel } from "@/config/food"
import type { OwnerFoodView } from "@/types/ownerListing"

interface FoodListingSummaryProps {
  /** The Food block of the listing as its owner / an admin reads it (`OwnerListingView.food`). */
  food: OwnerFoodView
  /** The listing's id and name: the heading id must be unique on the page, the menu image needs a label. */
  listingId: string
  name: string
  /** Heading level to fit the surrounding page/dialog outline (2 on a page, 3 inside a dialog). */
  headingLevel?: 2 | 3
}

/**
 * Compact read-only Food & Dining facts of a submitted Business: categories (the first is the primary one), the
 * service options, the hours note, the menu highlights and the menu image. Used by the Professional "View" dialog
 * and the Admin review panel, so the submitter and the moderator both see the Food data the generic business
 * line does not carry (S5A / B-01). It is a summary, not a menu editor - nothing here is interactive.
 */
function FoodListingSummary({ food, listingId, name, headingLevel = 3 }: FoodListingSummaryProps) {
  const menuHighlights = food.menuHighlights ?? []
  const [primary, ...secondary] = food.categories

  return (
    <section aria-labelledby={`food-summary-${listingId}`} className="flex min-w-0 flex-col gap-2">
      <Typography
        as={`h${headingLevel}`}
        variant="label"
        id={`food-summary-${listingId}`}
        className="text-xs"
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
          label={`${name} menu`}
          tone="accent"
          className="aspect-auto max-h-48 bg-muted object-contain"
        />
      )}
    </section>
  )
}

export { FoodListingSummary }
