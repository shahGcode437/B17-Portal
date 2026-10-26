import { MapPin, GraduationCap } from "lucide-react"
import type { Tutor } from "@/types/tutor"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Card } from "@/components/ui/card"
import { CardPreviewTrigger } from "@/components/cards/CardPreviewTrigger"
import { SaveButton } from "@/components/inputs/SaveButton"

interface TutorCardProps {
  tutor: Tutor
  onSelect?: () => void
}

/** Tutor card (Master Spec §11): name, subject, grade, area, bio. No contact action: none exists yet. */
function TutorCard({ tutor, onSelect }: TutorCardProps) {
  return (
    <Card
      variant="interactive"
      className="relative isolate"
      // Motion adds tabindex=0 to elements with a press gesture; the card container must not be a tab stop (the preview button is).
      tabIndex={-1}
    >
      <CardPreviewTrigger name={tutor.name} onSelect={onSelect} />
      <div className="relative">
        <CardImage src={tutor.image} icon={GraduationCap} label={tutor.name} decorative />
        <SaveButton kind="tutor" id={tutor.id} name={tutor.name} className="absolute right-2 top-2 z-20" />
      </div>
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="line-clamp-2 text-base">
            {tutor.name}
          </Typography>
        </Stack>
        <Typography variant="body-sm" className="text-primary">
          {tutor.subject} · {tutor.grade}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground line-clamp-2">
          {tutor.bio}
        </Typography>
        <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <Typography variant="caption">{tutor.area}</Typography>
        </Stack>
      </Stack>
    </Card>
  )
}

export { TutorCard }
