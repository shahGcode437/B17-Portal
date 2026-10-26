import { useEffect, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { MapPin, Wrench } from "lucide-react"
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
import { useGoBack } from "@/hooks/useGoBack"
import { useSignInGate } from "@/hooks/useSignInGate"
import { providerSeo } from "@/seo/entitySeo"
import { routes } from "@/config/routes"
import type { Provider } from "@/types/provider"

/**
 * Public Provider Profile (UI/UX Spec §11) - read from `GET /listings/{id}` (Phase 12G). Trust /
 * experience / verification rows are intentionally omitted: nothing here is backed by a real
 * process (Master Spec §9, §19).
 *
 * "Request Service" is real since Phase 12H: the dialog `POST`s to `/requests` with the backend
 * deriving the provider from this listing's owner. An anonymous visitor is sent to Log In first and comes back
 * to this dialog (`openRequestFor`); someone whose session is still being checked, or whose server cannot be
 * reached, is NOT sent to Log In (`useSignInGate`, Phase 12S).
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
  const location = useLocation()
  const auth = useAuth()
  const { requireSignIn } = useSignInGate()
  const goBack = useGoBack(routes.services)
  // Back from Log In with THIS provider's Request Service pending (LoginRegisterPage): reopen it, once.
  const resumeRequest = (location.state as { openRequestFor?: string } | null)?.openRequestFor === provider.id
  const [requestOpen, setRequestOpen] = useState(resumeRequest && auth.status === "authenticated")
  useSeo(providerSeo(provider))

  useEffect(() => {
    if (resumeRequest) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [resumeRequest, navigate, location.pathname, location.search])

  const handleRequestClick = () => requireSignIn(() => setRequestOpen(true), { loginState: { providerId: provider.id } })

  return (
    <DetailLayout
      onBack={goBack}
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
            <Button size="lg" className="w-full" onClick={handleRequestClick}>
              Request Service
            </Button>
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
