import { useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { MapPin, MessageCircle, Wrench } from "lucide-react"
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
import { getProviderById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { useAuth } from "@/hooks/useAuth"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import { RequestServiceDialog } from "@/features/services/RequestServiceDialog"

interface ProviderLocationState {
  openRequestFor?: string
}

/**
 * Public Provider Profile (UI/UX Spec §11). Trust/experience/verification
 * rows are intentionally omitted — nothing here is backed by a real process
 * (Master Spec §9, §19). WhatsApp is simulated for every visitor; Request
 * Service is gated behind the simulated auth session (Phase 3B).
 */
function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()
  const { user } = useAuth()
  const [isRequestOpen, setIsRequestOpen] = useState(false)
  const provider = id ? getProviderById(id) : undefined

  // Resume an interrupted Request Service intent after returning from login.
  // Clearing the location state below makes this effect's second run a
  // no-op, so it's safe to depend on the full, real set of values it reads.
  useEffect(() => {
    const state = location.state as ProviderLocationState | null
    if (provider && state?.openRequestFor === provider.id) {
      setIsRequestOpen(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [provider, location.pathname, location.state, navigate])

  function handleRequestService() {
    if (!provider) return
    if (!user) {
      navigate(routes.login, {
        state: { from: location.pathname, providerId: provider.id },
      })
      return
    }
    setIsRequestOpen(true)
  }

  if (!provider) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={Wrench}
          title="Provider not found"
          description="This provider listing doesn't exist or may no longer be available."
          actionLabel="Back to Search"
          onAction={() => navigate(routes.search)}
        />
      </Container>
    )
  }

  return (
    <>
      <DetailLayout
        onBack={() => navigate(-1)}
        notice="This is a prototype listing with demo details — it does not represent a real, verified B-17 provider."
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
            badges={<DemoBadge />}
            title={provider.name}
            subtitle={provider.categoryLabel}
            facts={<DetailFacts facts={[{ icon: MapPin, label: "Coverage area", value: provider.area, wide: true }]} />}
            actions={
              <>
                <Button size="lg" className="w-full" onClick={handleRequestService}>
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
        <DetailSection title="About">
          <Typography variant="body" className="break-words text-muted-foreground">
            {provider.description}
          </Typography>
        </DetailSection>
        {provider.tags.length > 0 && (
          <DetailSection title="Services offered">
            <DetailTagList tags={provider.tags} />
          </DetailSection>
        )}
      </DetailLayout>

      {user && (
        <RequestServiceDialog
          provider={provider}
          requesterName={user.name}
          open={isRequestOpen}
          onOpenChange={setIsRequestOpen}
        />
      )}
    </>
  )
}

export { ProviderProfilePage }
