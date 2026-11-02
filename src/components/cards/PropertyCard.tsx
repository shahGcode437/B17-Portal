import { BedDouble, Home, KeyRound, Sofa } from "lucide-react"
import type { Property } from "@/types/property"
import { Badge } from "@/components/ui/badge"
import { ListingCardShell } from "@/components/cards/ListingCardShell"
import type { CardFact } from "@/components/cards/cardFacts"

interface PropertyCardProps {
  property: Property
  onSelect?: () => void
}

/** The facts a buyer or renter scans for, only where the listing has them: type, bedrooms, furnishing. */
function propertyFacts(property: Property): CardFact[] {
  const facts: CardFact[] = [{ text: property.propertyType, icon: Home }]
  if (property.bedrooms) facts.push({ text: `${property.bedrooms} bed`, icon: BedDouble })
  if (property.furnished) facts.push({ text: property.furnished, icon: Sofa })
  return facts
}

/** Property card: sale or rent, price first, then the title, scannable facts and area. No contact action exists yet. */
function PropertyCard({ property, onSelect }: PropertyCardProps) {
  return (
    <ListingCardShell
      kind="property"
      id={property.id}
      name={property.title}
      typeLabel="Property"
      typeIcon={KeyRound}
      tone="accent"
      image={property.image}
      imageBadge={
        <Badge variant={property.listingType === "sale" ? "default" : "secondary"}>
          {property.listingType === "sale" ? "For Sale" : "For Rent"}
        </Badge>
      }
      highlight={property.price}
      title={property.title}
      facts={propertyFacts(property)}
      area={property.area}
      onSelect={onSelect}
    />
  )
}

export { PropertyCard }
