import { useState } from "react"
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
import { RequestServiceDialog } from "@/features/services/RequestServiceDialog"
import { useListing } from "@/hooks/useListings"
import { useAuth } from "@/hooks/useAuth"
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
 * "Request Service" is real since Phase 12H: the dialog `POST`s to `/requests` with the backend
 * deriving the provider from this listing's owner. An anonymous visitor is sent to Log In first.
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
  const auth = useAuth()
  const [requestOpen, setRequestOpen] = useState(false)
  useSeo(providerSeo(provider))

  const handleRequestClick = () => {
    if (auth.status !== "authenticated") {
      navigate(routes.login, { state: { from: `${window.location.pathname}${window.location.search}` } })
      return
    }
    setRequestOpen(true)
  }

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
              <Button size="lg" className="w-full" onClick={handleRequestClick}>
                Request Service
              </Button>
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
      <RequestServiceDialog
        provider={provider}
        requesterName={auth.user?.displayName ?? ""}
        open={requestOpen}
        onOpenChange={setRequestOpen}
      />
    </DetailLayout>
  )
}

export { ProviderProfilePage }
