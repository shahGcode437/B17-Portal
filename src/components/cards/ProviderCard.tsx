import { MapPin, MessageCircle, Wrench } from "lucide-react"
import { motion } from "motion/react"
import { useNavigate } from "react-router-dom"
import type { Provider } from "@/types/provider"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { cardHover } from "@/lib/motion"
import { providerProfilePath } from "@/config/routes"

interface ProviderCardProps {
  provider: Provider
  onSelect?: () => void
}

/** Provider card (Master Spec §11): name, category, area, trust info, CTA. */
function ProviderCard({ provider, onSelect }: ProviderCardProps) {
  const { show } = useToast()
  const navigate = useNavigate()

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
      aria-label={`Preview ${provider.name}`}
    >
      <CardImage src={provider.image} icon={Wrench} label={provider.name} />
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="text-base">
            {provider.name}
          </Typography>
          <DemoBadge />
        </Stack>
        <Typography variant="body-sm" className="text-primary">
          {provider.categoryLabel}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground line-clamp-2">
          {provider.description}
        </Typography>
        <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <Typography variant="caption">{provider.area}</Typography>
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
            navigate(providerProfilePath(provider.id))
          }}
        >
          Request
        </Button>
      </Stack>
    </motion.div>
  )
}

export { ProviderCard }
