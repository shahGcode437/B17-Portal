import { useNavigate, useParams } from "react-router-dom"
import { motion } from "motion/react"
import { ArrowLeft, MapPin, MessageCircle, GraduationCap } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { getTutorById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Public Tutor Profile (Master Spec Screen 14) — mirrors ProviderProfilePage's
 * structure. Guest-accessible, no auth gate (Master Spec §17: contact/WhatsApp
 * is guest-allowed). WhatsApp is the only CTA — no Request Service, no
 * booking, no verification/ratings beyond what the data actually contains.
 */
function TutorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show } = useToast()
  const tutor = id ? getTutorById(id) : undefined

  if (!tutor) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={GraduationCap}
          title="Tutor not found"
          description="This tutor profile doesn't exist or may no longer be available."
          actionLabel="Back to Education"
          onAction={() => navigate(routes.education)}
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
            <CardImage src={tutor.image} icon={GraduationCap} label={tutor.name} className="shadow-medium" />
            <SaveButton kind="tutor" id={tutor.id} name={tutor.name} className="absolute right-3 top-3" />
          </div>

          <Stack gap={4}>
            <Stack direction="row" justify="between" align="start" gap={3}>
              <Stack gap={1}>
                <Typography variant="h1" className="text-balance">
                  {tutor.name}
                </Typography>
                <Typography variant="body-lg" className="text-primary">
                  {tutor.subject} · {tutor.grade}
                </Typography>
              </Stack>
              <DemoBadge />
            </Stack>

            <Typography variant="body" className="text-muted-foreground">
              {tutor.bio}
            </Typography>

            <Stack gap={2}>
              <Typography variant="label">Subjects / Focus</Typography>
              <Stack direction="row" wrap gap={2}>
                {tutor.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal capitalize">
                    {tag}
                  </Badge>
                ))}
              </Stack>
            </Stack>

            <Stack gap={2}>
              <Typography variant="label">Area</Typography>
              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <Typography variant="body-sm">{tutor.area}</Typography>
              </Stack>
            </Stack>

            <Typography variant="caption" className="text-muted-foreground">
              This is a prototype tutor listing with demo details — it does not represent a real,
              verified B-17 tutor.
            </Typography>
          </Stack>

          <Button size="lg" className="w-full sm:w-auto" onClick={() => show(SIMULATED_MESSAGES.whatsapp)}>
            <MessageCircle />
            Chat on WhatsApp
          </Button>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { TutorProfilePage }
