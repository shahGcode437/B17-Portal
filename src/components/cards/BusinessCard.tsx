import { MapPin, MessageCircle, Building2, Star } from "lucide-react"
import { motion } from "motion/react"
import type { Business } from "@/types/business"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/inputs/SaveButton"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { cardHover } from "@/lib/motion"

interface BusinessCardProps {
  business: Business
  onSelect?: () => void
}

/** Business directory card (Master Spec §11): name, category, location, featured state. */
function BusinessCard({ business, onSelect }: BusinessCardProps) {
  const { show } = useToast()

  return (
    <motion.div
      {...cardHover}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`Preview ${business.name}`}
    >
      <div className="relative">
        <CardImage src={business.image} icon={Building2} label={business.name} tone="accent" />
        {business.featured && (
          <Badge className="absolute left-2 top-2 gap-1 bg-brand-accent text-brand-accent-foreground">
            <Star className="size-3" aria-hidden="true" />
            Featured
          </Badge>
        )}
        <SaveButton kind="business" id={business.id} name={business.name} className="absolute right-2 top-2" />
      </div>
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="text-base">
            {business.name}
          </Typography>
          <DemoBadge />
        </Stack>
        <Typography variant="body-sm" className="text-primary">
          {business.category}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground line-clamp-2">
          {business.description}
        </Typography>
        <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <Typography variant="caption">{business.area}</Typography>
        </Stack>
      </Stack>
      <Stack direction="row" gap={2} className="px-1 pb-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation()
            show(SIMULATED_MESSAGES.whatsapp)
          }}
        >
          <MessageCircle />
          WhatsApp
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation()
            show(SIMULATED_MESSAGES.contact)
          }}
        >
          Contact
        </Button>
      </Stack>
    </motion.div>
  )
}

export { BusinessCard }
