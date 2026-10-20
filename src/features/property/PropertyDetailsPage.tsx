import { useNavigate, useParams } from "react-router-dom"
import { MapPin, BedDouble, KeyRound, Home, Sofa } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts, type DetailFact } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { ListingDetailGate } from "@/components/detail/ListingDetailGate"
import { LocationSection } from "@/components/location/LocationSection"
import { useListing } from "@/hooks/useListings"
import { useSeo } from "@/hooks/useSeo"
import { propertySeo } from "@/seo/entitySeo"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import type { Property } from "@/types/property"

/**
 * Public Property Details (Master Spec Screen 17) - read from `GET /listings/{id}` (Phase 12G).
 * Guest-accessible (Master Spec §17). "Contact Agent" is the only CTA and it is simulated - no real
 * agent identity, booking, payment, legal verification, or transaction.
 */
function PropertyDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const read = useListing("property", id)

  return (
    <ListingDetailGate
      read={read}
      notFound={{
        icon: KeyRound,
        title: "Property not found",
        description: "This property listing doesn't exist or may no longer be available.",
        actionLabel: "Back to Property",
        onAction: () => navigate(routes.property),
      }}
    >
      {(property) => <PropertyDetails property={property} />}
    </ListingDetailGate>
  )
}

function PropertyDetails({ property }: { property: Property }) {
  const navigate = useNavigate()
  const { show } = useToast()
  useSeo(propertySeo(property))

  // Only facts the listing actually has - optional fields are simply omitted.
  const facts: DetailFact[] = [{ icon: Home, label: "Type", value: property.propertyType }]
  if (property.bedrooms) facts.push({ icon: BedDouble, label: "Bedrooms", value: String(property.bedrooms) })
  if (property.furnished) facts.push({ icon: Sofa, label: "Furnishing", value: property.furnished })
  facts.push({ icon: MapPin, label: "Area", value: property.area, wide: true })

  return (
    <DetailLayout
      onBack={() => navigate(-1)}
      hero={
        <DetailHero
          src={property.image}
          icon={KeyRound}
          label={property.title}
          tone="accent"
          aspectClassName="aspect-[4/3] sm:aspect-[16/10]"
          badges={
            <Badge variant={property.listingType === "sale" ? "default" : "secondary"}>
              {property.listingType === "sale" ? "For Sale" : "For Rent"}
            </Badge>
          }
          action={<SaveButton kind="property" id={property.id} name={property.title} />}
        />
      }
      summary={
        <DetailSummary
          title={property.title}
          highlight={property.price}
          facts={<DetailFacts facts={facts} />}
          actions={
            <Button size="lg" className="w-full" onClick={() => show(SIMULATED_MESSAGES.contact)}>
              Contact Agent
            </Button>
          }
        />
      }
    >
      {property.description && (
        <DetailSection title="About this property">
          <Typography variant="body" className="break-words text-muted-foreground">
            {property.description}
          </Typography>
        </DetailSection>
      )}
      <LocationSection name={property.title} area={property.area} location={property.location} />
      {property.tags.length > 0 && (
        <DetailSection title="Details">
          <DetailTagList tags={property.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { PropertyDetailsPage }
