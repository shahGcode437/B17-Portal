import { useNavigate, useParams } from "react-router-dom"
import { MapPin, MessageCircle, Wrench } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { FeaturedBadge } from "@/components/detail/FeaturedBadge"
import { ListingDetailGate } from "@/components/detail/ListingDetailGate"
import { LocationSection } from "@/components/location/LocationSection"
import { useListing } from "@/hooks/useListings"
import { useSeo } from "@/hooks/useSeo"
import { providerSeo } from "@/seo/entitySeo"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import type { Provider } from "@/types/provider"

/**
 * Public Provider Profile (UI/UX Spec §11) - read from `GET /listings/{id}` (Phase 12G). Trust /
 * experience / verification rows are intentionally omitted: nothing here is backed by a real
 * process (Master Spec §9, §19). WhatsApp stays simulated.
 *
 * "Request Service" is NOT available yet: the requests API exists (Phase 12F) but the form is wired
 * to it in Phase 12H, and the old demo dialog only pretended to record a request. Until then the
 * button is disabled and says why, rather than reporting a success that was never persisted.
 */
function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const read = useListing("provider", id)

  return (
    <ListingDetailGate
      read={read}
      notFound={{
        icon: Wrench,
        title: "Provider not found",
        description: "This provider listing doesn't exist or may no longer be available.",
        actionLabel: "Back to Search",
        onAction: () => navigate(routes.search),
      }}
    >
      {(provider) => <ProviderProfile provider={provider} />}
    </ListingDetailGate>
  )
}

function ProviderProfile({ provider }: { provider: Provider }) {
  const navigate = useNavigate()
  const { show } = useToast()
  useSeo(providerSeo(provider))

  return (
    <DetailLayout
      onBack={() => navigate(-1)}
      hero={
        <DetailHero
          src={provider.image}
          icon={Wrench}
          label={provider.name}
          badges={provider.featured && <FeaturedBadge />}
          action={<SaveButton kind="provider" id={provider.id} name={provider.name} />}
        />
      }
      summary={
        <DetailSummary
          title={provider.name}
          subtitle={provider.categoryLabel}
          facts={<DetailFacts facts={[{ icon: MapPin, label: "Coverage area", value: provider.area, wide: true }]} />}
          actions={
            <>
              <Button size="lg" className="w-full" disabled aria-describedby="request-service-note">
                Request Service
              </Button>
              <Typography id="request-service-note" variant="caption">
                Sending requests is coming soon.
              </Typography>
              <Button size="lg" variant="outline" className="w-full" onClick={() => show(SIMULATED_MESSAGES.whatsapp)}>
                <MessageCircle />
                Contact on WhatsApp
              </Button>
            </>
          }
        />
      }
    >
      {provider.description && (
        <DetailSection title="About">
          <Typography variant="body" className="break-words text-muted-foreground">
            {provider.description}
          </Typography>
        </DetailSection>
      )}
      <LocationSection name={provider.name} area={provider.area} location={provider.location} title="Coverage area" />
      {provider.tags.length > 0 && (
        <DetailSection title="Services offered">
          <DetailTagList tags={provider.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { ProviderProfilePage }
