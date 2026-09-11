import { useParams, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft, MapPin, MessageCircle, Wrench } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getProviderById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Public Provider Profile (UI/UX Spec §11). Trust/experience/verification
 * rows are intentionally omitted — nothing here is backed by a real process
 * (Master Spec §9, §19). Request Service and WhatsApp are both simulated;
 * the real request flow arrives with Auth in Phase 4.
 */
function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const provider = id ? getProviderById(id) : undefined

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
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6} className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </button>

          <CardImage src={provider.image} icon={Wrench} label={provider.name} className="shadow-medium" />

          <Stack gap={4}>
            <Stack direction="row" justify="between" align="start" gap={3}>
              <Stack gap={1}>
                <Typography variant="h1" className="text-balance">
                  {provider.name}
                </Typography>
                <Typography variant="body-lg" className="text-primary">
                  {provider.categoryLabel}
                </Typography>
              </Stack>
              <DemoBadge />
            </Stack>

            <Typography variant="body" className="text-muted-foreground">
              {provider.description}
            </Typography>

            <Stack gap={2}>
              <Typography variant="label">Services Offered</Typography>
              <Stack direction="row" wrap gap={2}>
                {provider.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal capitalize">
                    {tag}
                  </Badge>
                ))}
              </Stack>
            </Stack>

            <Stack gap={2}>
              <Typography variant="label">Coverage Area</Typography>
              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">{provider.area}</Typography>
              </Stack>
            </Stack>

            <Typography variant="caption" className="text-muted-foreground">
              This is a prototype listing with demo details — it does not represent a real,
              verified B-17 provider.
            </Typography>
          </Stack>

          <Stack gap={3} className="flex-col sm:flex-row">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={() => show(SIMULATED_MESSAGES.whatsapp)}
            >
              <MessageCircle />
              Contact on WhatsApp
            </Button>
            <Button size="lg" className="flex-1" onClick={() => show(SIMULATED_MESSAGES.requestService)}>
              Request Service
            </Button>
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProviderProfilePage }
