import { useNavigate, useParams } from "react-router-dom"
import { GraduationCap, School } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { SaveButton } from "@/components/inputs/SaveButton"
import { DetailLayout } from "@/components/detail/DetailLayout"
import { DetailHero } from "@/components/detail/DetailHero"
import { DetailSummary } from "@/components/detail/DetailSummary"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailActionRegion } from "@/components/detail/DetailActionRegion"
import { DetailFactTiles } from "@/components/detail/DetailFactTiles"
import { DetailTagList } from "@/components/detail/DetailTagList"
import { DetailTypeChip } from "@/components/detail/DetailTypeChip"
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
          variant="banner"
          src={tutor.image}
          icon={GraduationCap}
          label={tutor.name}
          badges={<DetailTypeChip icon={GraduationCap} label="Tutor" />}
          action={<SaveButton kind="tutor" id={tutor.id} name={tutor.name} />}
        />
      }
      summary={
        <DetailSummary
          title={tutor.name}
          subtitle={tutor.subject}
          area={tutor.area}
          facts={<DetailFactTiles facts={[{ icon: School, label: "Grade", value: tutor.grade }]} />}
          actions={<DetailActionRegion unavailableMessage="Contacting this tutor through B-17 Portal isn&apos;t available yet." />}
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
      {tutor.tags.length > 0 && (
        <DetailSection title="Subjects & focus">
          <DetailTagList tags={tutor.tags} />
        </DetailSection>
      )}
      <LocationSection name={tutor.name} area={tutor.area} location={tutor.location} />
    </DetailLayout>
  )
}

export { TutorProfilePage }
