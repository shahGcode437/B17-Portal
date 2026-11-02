import { Building2, Clock, Utensils } from "lucide-react"
import type { Business } from "@/types/business"
import { ListingCardShell } from "@/components/cards/ListingCardShell"
import { tagFacts, type CardFact } from "@/components/cards/cardFacts"
import { FOOD_VERTICAL_LABEL, foodServiceLabel } from "@/config/food"

interface BusinessCardProps {
  business: Business
  onSelect?: () => void
}

/** A Food & Dining business: its real opening-hours note and service options (never a delivery estimate or an order action). */
function foodFacts(food: NonNullable<Business["food"]>): CardFact[] {
  const facts: CardFact[] = []
  if (food.hoursNote) facts.push({ text: food.hoursNote, icon: Clock })
  for (const option of food.serviceOptions) facts.push({ text: foodServiceLabel(option) })
  return facts
}

/**
 * Business directory card. A Food & Dining business is the same record with `vertical === "food"` (never a
 * separate kind), so it is the same card with food-specific facts. There is no contact action: no contact
 * path exists for businesses yet, so nothing here pretends to be one.
 */
function BusinessCard({ business, onSelect }: BusinessCardProps) {
  const food = business.vertical === "food" ? business.food : undefined

  return (
    <ListingCardShell
      kind="business"
      id={business.id}
      name={business.name}
      typeLabel={business.vertical === "food" ? FOOD_VERTICAL_LABEL : "Business"}
      typeIcon={business.vertical === "food" ? Utensils : Building2}
      tone="accent"
      image={business.image}
      featured={business.featured}
      title={business.name}
      subtitle={business.category}
      description={business.description}
      facts={food ? foodFacts(food) : tagFacts(business.tags)}
      area={business.area}
      onSelect={onSelect}
    />
  )
}

export { BusinessCard }
