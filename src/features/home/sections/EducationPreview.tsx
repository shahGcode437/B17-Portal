import { TutorCard } from "@/components/cards/TutorCard"
import { PreviewSection } from "@/features/home/PreviewSection"
import { useTutors } from "@/hooks/useListings"
import { mapTutorToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import type { SearchResult } from "@/types/search"

interface EducationPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Education/Tutor discovery preview (Prototype Scope §10) - individual professionals as first-class listings. */
function EducationPreview({ onSelect }: EducationPreviewProps) {
  const tutors = useTutors(3)

  return (
    <PreviewSection
      title="Education & Tutors"
      description="Schools, academies and individual tutors — like this Physics tutor example."
      viewAllPath={`${routes.search}?type=tutor`}
      read={tutors}
      cols={3}
      limit={3}
      getKey={(tutor) => tutor.id}
      renderCard={(tutor) => <TutorCard tutor={tutor} onSelect={() => onSelect(mapTutorToResult(tutor))} />}
    />
  )
}

export { EducationPreview }
