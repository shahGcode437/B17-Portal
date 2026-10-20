import { useNavigate, useParams } from "react-router-dom"
import { MapPin, MessageCircle, GraduationCap, BookOpen } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts } from "@/components/detail/DetailFacts"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { ListingDetailGate } from "@/components/detail/ListingDetailGate"
import { LocationSection } from "@/components/location/LocationSection"
import { useListing } from "@/hooks/useListings"
import { useSeo } from "@/hooks/useSeo"
import { tutorSeo } from "@/seo/entitySeo"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { routes } from "@/config/routes"
import type { Tutor } from "@/types/tutor"

/**
 * Public Tutor Profile (Master Spec Screen 14) - read from `GET /listings/{id}` (Phase 12G).
 * Guest-accessible (Master Spec §17). WhatsApp is the only CTA, and it is simulated: there is no
 * contact data, booking, or verification beyond what the listing contains.
 */
function TutorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const read = useListing("tutor", id)

  return (
    <ListingDetailGate
      read={read}
      notFound={{
        icon: GraduationCap,
        title: "Tutor not found",
        description: "This tutor profile doesn't exist or may no longer be available.",
        actionLabel: "Back to Education",
        onAction: () => navigate(routes.education),
      }}
    >
      {(tutor) => <TutorProfile tutor={tutor} />}
    </ListingDetailGate>
  )
}

function TutorProfile({ tutor }: { tutor: Tutor }) {
  const navigate = useNavigate()
  const { show } = useToast()
  useSeo(tutorSeo(tutor))

  return (
    <DetailLayout
      onBack={() => navigate(-1)}
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
      {tutor.bio && (
        <DetailSection title="About">
          <Typography variant="body" className="break-words text-muted-foreground">
            {tutor.bio}
          </Typography>
        </DetailSection>
      )}
      <LocationSection name={tutor.name} area={tutor.area} location={tutor.location} />
      {tutor.tags.length > 0 && (
        <DetailSection title="Subjects & focus">
          <DetailTagList tags={tutor.tags} />
        </DetailSection>
      )}
    </DetailLayout>
  )
}

export { TutorProfilePage }
