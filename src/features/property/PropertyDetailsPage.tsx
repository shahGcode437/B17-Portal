import { useNavigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft, MapPin, BedDouble, KeyRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getPropertyById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

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
          icon={KeyRound}
          title="Property not found"
          description="This property listing doesn't exist or may no longer be available."
          actionLabel="Back to Property"
          onAction={() => navigate(routes.property)}
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
              src={property.image}
              icon={KeyRound}
              label={property.title}
              tone="accent"
              className="shadow-medium"
            />
            <Badge
              className="absolute left-3 top-3"
              variant={property.listingType === "sale" ? "default" : "secondary"}
            >
              {property.listingType === "sale" ? "For Sale" : "For Rent"}
            </Badge>
          </div>

          <Stack gap={4}>
            <Stack direction="row" justify="between" align="start" gap={3}>
              <Stack gap={1}>
                <Typography variant="h1" className="text-balance">
                  {property.title}
                </Typography>
                <Typography variant="body-lg" className="font-medium text-primary">
                  {property.price}
                </Typography>
              </Stack>
              <DemoBadge />
            </Stack>

            <Stack direction="row" wrap gap={4} className="text-muted-foreground">
              <Stack direction="row" align="center" gap={1}>
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">{property.area}</Typography>
              </Stack>
              <Typography variant="body-sm">{property.propertyType}</Typography>
              {property.bedrooms && (
                <Stack direction="row" align="center" gap={1}>
                  <BedDouble className="size-4 shrink-0" aria-hidden="true" />
                  <Typography variant="body-sm">{property.bedrooms} bed</Typography>
                </Stack>
              )}
              {property.furnished && <Typography variant="body-sm">{property.furnished}</Typography>}
            </Stack>

            {property.description && (
              <Typography variant="body" className="text-muted-foreground">
                {property.description}
              </Typography>
            )}

            {property.tags.length > 0 && (
              <Stack gap={2}>
                <Typography variant="label">Details</Typography>
                <Stack direction="row" wrap gap={2}>
                  {property.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal capitalize">
                      {tag}
                    </Badge>
                  ))}
                </Stack>
              </Stack>
            )}

            <Typography variant="caption" className="text-muted-foreground">
              This is a prototype property listing with demo details — it does not represent a
              real, verified B-17 property or transaction.
            </Typography>
          </Stack>

          <Button size="lg" className="w-full sm:w-auto" onClick={() => show(SIMULATED_MESSAGES.contact)}>
            Contact Agent
          </Button>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { PropertyDetailsPage }
