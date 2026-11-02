import { useNavigate, useParams } from "react-router-dom"
import { Building2, Clock, Utensils, UtensilsCrossed } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailActionRegion } from "@/components/detail/DetailActionRegion"
import { DetailFactTiles } from "@/components/detail/DetailFactTiles"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { DetailTypeChip } from "@/components/detail/DetailTypeChip"
import { FeaturedBadge } from "@/components/detail/FeaturedBadge"
import { ListingDetailGate } from "@/components/detail/ListingDetailGate"
import { LocationSection } from "@/components/location/LocationSection"
import { FoodDetailSections } from "@/features/directory/FoodDetailSections"
import { FOOD_VERTICAL_LABEL, foodCategoryLabel } from "@/config/food"
import type { DetailFact } from "@/components/detail/DetailFacts"
import { useListing } from "@/hooks/useListings"
import { useSeo } from "@/hooks/useSeo"
import { useGoBack } from "@/hooks/useGoBack"
import { businessSeo } from "@/seo/entitySeo"
import { routes } from "@/config/routes"
import type { Business } from "@/types/business"

/**
 * Public Business Profile (Master Spec Screen 11) - read from `GET /listings/{id}` (Phase 12G).
 * Guest-accessible, no auth gate (Master Spec §17). Food & Dining is the same page: it is a
 * vertical of Business (`vertical === "food"`), never a separate kind or route. There is no
 * contact action: no contact data, chat or delivery exists (DECISIONS.md, O-3), so the page says so.
 */
function BusinessProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const read = useListing("business", id)

  return (
    <ListingDetailGate
      read={read}
      notFound={{
        icon: Building2,
        title: "Business not found",
        description: "This business listing doesn't exist or may no longer be available.",
        actionLabel: "Back to Directory",
        onAction: () => navigate(routes.directory),
      }}
    >
      {(business) => <BusinessProfile business={business} />}
    </ListingDetailGate>
  )
}

function BusinessProfile({ business }: { business: Business }) {
  const isFood = business.vertical === "food"
  const goBack = useGoBack(isFood ? routes.food : routes.directory)
  useSeo(businessSeo(business))

  // Food & Dining: everything below is conditional on the Business's own vertical - a general
  // Business renders as before. `business.category` already is the primary category's name, so only
  // the *other* categories are listed ("Also serves"), with the names the server supplied.
  const food = isFood ? business.food : undefined
  const alsoServes = food?.categories
    .slice(1)
    .map((slug) => food.categoryLabels?.[slug] ?? foodCategoryLabel(slug))
    .join(", ")
  const facts: DetailFact[] = []
  if (food?.hoursNote) facts.push({ icon: Clock, label: "Hours", value: food.hoursNote, wide: true })
  if (alsoServes) facts.push({ icon: UtensilsCrossed, label: "Also serves", value: alsoServes, wide: true })

  return (
    <DetailLayout
      onBack={goBack}
      hero={
        <DetailHero
          variant="banner"
          src={business.image}
          icon={isFood ? Utensils : Building2}
          label={business.name}
          tone="accent"
          badges={
            <>
              <DetailTypeChip icon={isFood ? Utensils : Building2} label={isFood ? FOOD_VERTICAL_LABEL : "Business"} />
              {business.featured && <FeaturedBadge />}
            </>
          }
          action={<SaveButton kind="business" id={business.id} name={business.name} />}
        />
      }
      summary={
        <DetailSummary
          title={business.name}
          subtitle={business.category}
          area={business.area}
          facts={<DetailFactTiles facts={facts} />}
          actions={<DetailActionRegion unavailableMessage="Contacting this business through B-17 Portal isn&apos;t available yet." />}
        />
      }
    >
      {business.description && (
        <DetailSection title="About">
          <Typography variant="body" className="break-words text-muted-foreground">
            {business.description}
          </Typography>
        </DetailSection>
      )}
      {food && <FoodDetailSections businessName={business.name} food={food} />}
      <LocationSection name={business.name} area={business.area} location={business.location} />
      {business.tags.length > 0 && (
        <DetailSection title="Details">
          <DetailTagList tags={business.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { BusinessProfilePage }
