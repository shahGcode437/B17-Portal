import { useNavigate, useParams } from "react-router-dom"
import { MapPin, GraduationCap, BookOpen } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
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
import { useGoBack } from "@/hooks/useGoBack"
import { tutorSeo } from "@/seo/entitySeo"
import { routes } from "@/config/routes"
import type { Tutor } from "@/types/tutor"

/**
 * Public Tutor Profile (Master Spec Screen 14) - read from `GET /listings/{id}` (Phase 12G).
 * Guest-accessible (Master Spec §17). There is no contact action: no contact data, booking or
 * verification exists beyond what the listing contains, so the page says so.
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
  const goBack = useGoBack(routes.education)
  useSeo(tutorSeo(tutor))

  return (
    <DetailLayout
      onBack={goBack}
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
            <Typography variant="body-sm" className="text-muted-foreground">
              Contacting this tutor through B-17 Portal isn&apos;t available yet.
            </Typography>
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
