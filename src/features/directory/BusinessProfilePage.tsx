import { useNavigate, useParams } from "react-router-dom"
import { MapPin, MessageCircle, Building2 } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { FeaturedBadge } from "@/components/detail/FeaturedBadge"
import { getBusinessById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"

/**
 * Public Business Profile (Master Spec Screen 11) — mirrors TutorProfilePage/
 * PropertyDetailsPage/ProviderProfilePage. Guest-accessible, no auth gate
 * (Master Spec §17). "Contact Business" is the primary CTA, with the same
 * simulated WhatsApp option BusinessCard already offers — no real contact
 * details, reviews, ratings, or verification beyond what the data contains.
 */
function BusinessProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const business = id ? getBusinessById(id) : undefined

  if (!business) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={Building2}
          title="Business not found"
          description="This business listing doesn't exist or may no longer be available."
          actionLabel="Back to Directory"
          onAction={() => navigate(routes.directory)}
        />
      </Container>
    )
  }

  return (
    <DetailLayout
      onBack={() => navigate(-1)}
      notice="This is a prototype business listing with demo details — it does not represent a real, verified B-17 business."
      hero={
        <DetailHero
          src={business.image}
          icon={Building2}
          label={business.name}
          tone="accent"
          badges={business.featured && <FeaturedBadge />}
          action={<SaveButton kind="business" id={business.id} name={business.name} />}
        />
      }
      summary={
        <DetailSummary
          badges={<DemoBadge />}
          title={business.name}
          subtitle={business.category}
          facts={<DetailFacts facts={[{ icon: MapPin, label: "Area", value: business.area, wide: true }]} />}
          actions={
            <>
              <Button size="lg" className="w-full" onClick={() => show(SIMULATED_MESSAGES.contact)}>
                Contact Business
              </Button>
              <Button size="lg" variant="outline" className="w-full" onClick={() => show(SIMULATED_MESSAGES.whatsapp)}>
                <MessageCircle />
                WhatsApp
              </Button>
            </>
          }
        />
      }
    >
      <DetailSection title="About">
        <Typography variant="body" className="break-words text-muted-foreground">
          {business.description}
        </Typography>
      </DetailSection>
      {business.tags.length > 0 && (
        <DetailSection title="Details">
          <DetailTagList tags={business.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { BusinessProfilePage }
