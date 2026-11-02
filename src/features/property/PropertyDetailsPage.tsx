import { useNavigate, useParams } from "react-router-dom"
import { BedDouble, Home, KeyRound, Sofa } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailActionRegion } from "@/components/detail/DetailActionRegion"
import { DetailFactTiles } from "@/components/detail/DetailFactTiles"
import { type DetailFact } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { DetailTypeChip } from "@/components/detail/DetailTypeChip"
import { ListingDetailGate } from "@/components/detail/ListingDetailGate"
import { LocationSection } from "@/components/location/LocationSection"
import { useListing } from "@/hooks/useListings"
import { useSeo } from "@/hooks/useSeo"
import { useGoBack } from "@/hooks/useGoBack"
import { propertySeo } from "@/seo/entitySeo"
import { routes } from "@/config/routes"
import type { Property } from "@/types/property"

/**
 * Public Property Details (Master Spec Screen 17) - read from `GET /listings/{id}` (Phase 12G).
 * Guest-accessible (Master Spec §17). There is no contact action: no agent identity, booking, payment,
 * legal verification or transaction exists, so the page says so.
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
  const goBack = useGoBack(routes.property)
  useSeo(propertySeo(property))

  // Only facts the listing actually has - optional fields are simply omitted.
  const facts: DetailFact[] = [{ icon: Home, label: "Type", value: property.propertyType }]
  if (property.bedrooms) facts.push({ icon: BedDouble, label: "Bedrooms", value: String(property.bedrooms) })
  if (property.furnished) facts.push({ icon: Sofa, label: "Furnishing", value: property.furnished })

  return (
    <DetailLayout
      onBack={goBack}
      hero={
        <DetailHero
          variant="banner"
          src={property.image}
          icon={KeyRound}
          label={property.title}
          tone="accent"
          badges={<DetailTypeChip icon={KeyRound} label={property.listingType === "sale" ? "For Sale" : "For Rent"} />}
          action={<SaveButton kind="property" id={property.id} name={property.title} />}
        />
      }
      summary={
        <DetailSummary
          title={property.title}
          highlight={property.price}
          area={property.area}
          facts={<DetailFactTiles facts={facts} />}
          actions={<DetailActionRegion unavailableMessage="Contacting the lister through B-17 Portal isn&apos;t available yet." />}
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
