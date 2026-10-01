import { MapPin, MessageCircle, GraduationCap } from "lucide-react"
import type { Tutor } from "@/types/tutor"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SaveButton } from "@/components/inputs/SaveButton"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"

interface TutorCardProps {
  tutor: Tutor
  onSelect?: () => void
}

/** Tutor card (Master Spec §11): name, subject, grade, area, bio, WhatsApp. */
function TutorCard({ tutor, onSelect }: TutorCardProps) {
  const { show } = useToast()

  return (
    <Card
      variant="interactive"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
      aria-label={`Preview ${tutor.name}`}
    >
      <div className="relative">
        <CardImage src={tutor.image} icon={GraduationCap} label={tutor.name} />
        <SaveButton kind="tutor" id={tutor.id} name={tutor.name} className="absolute right-2 top-2" />
      </div>
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="text-base">
            {tutor.name}
          </Typography>
          <DemoBadge />
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
      <div className="px-1 pb-1">
        <Button
          size="sm"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation()
            show(SIMULATED_MESSAGES.whatsapp)
          }}
        >
          <MessageCircle />
          Chat on WhatsApp
        </Button>
      </div>
    </Card>
  )
}

export { TutorCard }
