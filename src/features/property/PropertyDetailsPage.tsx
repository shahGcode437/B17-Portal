import { useNavigate, useParams } from "react-router-dom"
import { MapPin, BedDouble, KeyRound, Home, Sofa } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts, type DetailFact } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { getPropertyById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"

/**
 * Public Property Details (Master Spec Screen 17) — mirrors TutorProfilePage/
 * ProviderProfilePage. Guest-accessible, no auth gate (Master Spec §17).
 * "Contact Agent" is the only CTA — no real agent identity, booking,
 * payment, mortgage, legal verification, or transaction.
 */
function PropertyDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const property = id ? getPropertyById(id) : undefined

  if (!property) {
    return (
      <Container className="py-16">
        <EmptyState
          headingLevel={1}
          icon={KeyRound}
          title="Property not found"
          description="This property listing doesn't exist or may no longer be available."
          actionLabel="Back to Property"
          onAction={() => navigate(routes.property)}
        />
      </Container>
    )
  }

  // Only facts the listing actually has — optional fields are simply omitted.
  const facts: DetailFact[] = [{ icon: Home, label: "Type", value: property.propertyType }]
  if (property.bedrooms) facts.push({ icon: BedDouble, label: "Bedrooms", value: String(property.bedrooms) })
  if (property.furnished) facts.push({ icon: Sofa, label: "Furnishing", value: property.furnished })
  facts.push({ icon: MapPin, label: "Area", value: property.area, wide: true })

  return (
    <DetailLayout
      onBack={() => navigate(-1)}
      notice="This is a prototype property listing with demo details — it does not represent a real, verified B-17 property or transaction."
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
          badges={<DemoBadge />}
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
      {property.tags.length > 0 && (
        <DetailSection title="Details">
          <DetailTagList tags={property.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { PropertyDetailsPage }
