import { useNavigate, useParams } from "react-router-dom"
import { MapPin, MessageCircle, GraduationCap, BookOpen } from "lucide-react"
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
import { getTutorById } from "@/services/search"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"

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
    <DetailLayout
      onBack={() => navigate(-1)}
      notice="This is a prototype tutor listing with demo details — it does not represent a real, verified B-17 tutor."
      hero={
        <DetailHero
          src={tutor.image}
          icon={GraduationCap}
          label={tutor.name}
          action={<SaveButton kind="tutor" id={tutor.id} name={tutor.name} />}
        />
      }
      summary={
        <DetailSummary
          badges={<DemoBadge />}
          title={tutor.name}
          facts={
            <DetailFacts
              facts={[
                { icon: BookOpen, label: "Subject", value: tutor.subject },
                { icon: GraduationCap, label: "Grade", value: tutor.grade },
                { icon: MapPin, label: "Area", value: tutor.area, wide: true },
              ]}
            />
          }
          actions={
            <Button size="lg" className="w-full" onClick={() => show(SIMULATED_MESSAGES.whatsapp)}>
              <MessageCircle />
              Chat on WhatsApp
            </Button>
          }
        />
      }
    >
      <DetailSection title="About">
        <Typography variant="body" className="break-words text-muted-foreground">
          {tutor.bio}
        </Typography>
      </DetailSection>
      {tutor.tags.length > 0 && (
        <DetailSection title="Subjects & focus">
          <DetailTagList tags={tutor.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { TutorProfilePage }
