import { useNavigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft, MapPin, MessageCircle, Building2, Star } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getBusinessById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

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

          <div className="relative">
            <CardImage
              src={business.image}
              icon={Building2}
              label={business.name}
              tone="accent"
              className="shadow-medium"
            />
            {business.featured && (
              <Badge className="absolute left-3 top-3 gap-1 bg-brand-accent text-brand-accent-foreground">
                <Star className="size-3" aria-hidden="true" />
                Featured
              </Badge>
            )}
          </div>

          <Stack gap={4}>
            <Stack direction="row" justify="between" align="start" gap={3}>
              <Stack gap={1}>
                <Typography variant="h1" className="text-balance">
                  {business.name}
                </Typography>
                <Typography variant="body-lg" className="text-primary">
                  {business.category}
                </Typography>
              </Stack>
              <DemoBadge />
            </Stack>

            <Typography variant="body" className="text-muted-foreground">
              {business.description}
            </Typography>

            <Stack gap={2}>
              <Typography variant="label">Area</Typography>
              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">{business.area}</Typography>
              </Stack>
            </Stack>

            {business.tags.length > 0 && (
              <Stack gap={2}>
                <Typography variant="label">Details</Typography>
                <Stack direction="row" wrap gap={2}>
                  {business.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal capitalize">
                      {tag}
                    </Badge>
                  ))}
                </Stack>
              </Stack>
            )}

            <Typography variant="caption" className="text-muted-foreground">
              This is a prototype business listing with demo details — it does not represent a
              real, verified B-17 business.
            </Typography>
          </Stack>

          <Stack gap={2} className="flex-col-reverse sm:flex-row">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={() => show(SIMULATED_MESSAGES.whatsapp)}
            >
              <MessageCircle />
              WhatsApp
            </Button>
            <Button size="lg" className="flex-1" onClick={() => show(SIMULATED_MESSAGES.contact)}>
              Contact Business
            </Button>
          </Stack>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { BusinessProfilePage }
