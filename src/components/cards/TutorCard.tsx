import { GraduationCap } from "lucide-react"
import type { Tutor } from "@/types/tutor"
import { ListingCardShell } from "@/components/cards/ListingCardShell"
import { tagFacts } from "@/components/cards/cardFacts"

interface TutorCardProps {
  tutor: Tutor
  onSelect?: () => void
}

/** Tutor card: name, subject and grade, topics, area, bio. No contact action: none exists yet. */
function TutorCard({ tutor, onSelect }: TutorCardProps) {
  return (
    <ListingCardShell
      kind="tutor"
      id={tutor.id}
      name={tutor.name}
      typeLabel="Tutor"
      typeIcon={GraduationCap}
      image={tutor.image}
      title={tutor.name}
      subtitle={`${tutor.subject} · ${tutor.grade}`}
      description={tutor.bio}
      facts={tagFacts(tutor.tags)}
      area={tutor.area}
      onSelect={onSelect}
    />
  )
}

export { TutorCard }
