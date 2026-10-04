import { useNavigate, useParams } from "react-router-dom"
import { MapPin, MessageCircle, Building2, Clock, Utensils, UtensilsCrossed } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { FeaturedBadge } from "@/components/detail/FeaturedBadge"
import { FoodDetailSections } from "@/features/directory/FoodDetailSections"
import { FOOD_VERTICAL_LABEL, foodCategoryLabel } from "@/config/food"
import type { DetailFact } from "@/components/detail/DetailFacts"
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
          headingLevel={1}
          icon={Building2}
          title="Business not found"
          description="This business listing doesn't exist or may no longer be available."
          actionLabel="Back to Directory"
          onAction={() => navigate(routes.directory)}
        />
      </Container>
    )
  }

  // Food & Dining (FD3): everything below is conditional on the Business's own vertical — a general
  // Business renders exactly as before. `business.category` already is the primary Food category label,
  // so only the *other* categories are listed ("Also serves"); labels come from the canonical config.
  const food = business.vertical === "food" ? business.food : undefined
  const alsoServes = food?.categories.slice(1).map(foodCategoryLabel).join(", ")
  const facts: DetailFact[] = [{ icon: MapPin, label: "Area", value: business.area, wide: true }]
  if (food?.hoursNote) facts.push({ icon: Clock, label: "Hours", value: food.hoursNote, wide: true })
  if (alsoServes) facts.push({ icon: UtensilsCrossed, label: "Also serves", value: alsoServes, wide: true })

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
          badges={
            <>
              <DemoBadge />
              {business.vertical === "food" && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Utensils className="size-3" aria-hidden="true" />
                  {FOOD_VERTICAL_LABEL}
                </Badge>
              )}
            </>
          }
          title={business.name}
          subtitle={business.category}
          facts={<DetailFacts facts={facts} />}
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
      {food && <FoodDetailSections businessName={business.name} food={food} />}
      {business.tags.length > 0 && (
        <DetailSection title="Details">
          <DetailTagList tags={business.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { BusinessProfilePage }
