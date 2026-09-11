import { MapPin, BedDouble, KeyRound } from "lucide-react"
import { motion } from "motion/react"
import type { Property } from "@/types/property"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"
import { cardHover } from "@/lib/motion"

interface PropertyCardProps {
  property: Property
  onSelect?: () => void
}

/** Property card (Master Spec §11): image, sale/rent, price, type, location, key facts. */
function PropertyCard({ property, onSelect }: PropertyCardProps) {
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
      aria-label={`Preview ${property.title}`}
    >
      <div className="relative">
        <CardImage src={property.image} icon={KeyRound} label={property.title} tone="accent" />
        <Badge
          className="absolute left-2 top-2"
          variant={property.listingType === "sale" ? "default" : "secondary"}
        >
          {property.listingType === "sale" ? "For Sale" : "For Rent"}
        </Badge>
      </div>
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="text-base">
            {property.title}
          </Typography>
          <DemoBadge />
        </Stack>
        <Typography variant="body-sm" className="font-medium text-primary">
          {property.price}
        </Typography>
        <Stack direction="row" wrap gap={3} className="text-muted-foreground">
          <Stack direction="row" align="center" gap={1}>
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <Typography variant="caption">{property.area}</Typography>
          </Stack>
          {property.bedrooms && (
            <Stack direction="row" align="center" gap={1}>
              <BedDouble className="size-3.5 shrink-0" aria-hidden="true" />
              <Typography variant="caption">{property.bedrooms} bed</Typography>
            </Stack>
          )}
        </Stack>
      </Stack>
      <div className="px-1 pb-1">
        <Button
          size="sm"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation()
            show(SIMULATED_MESSAGES.contact)
          }}
        >
          Contact Agent
        </Button>
      </div>
    </motion.div>
  )
}

export { PropertyCard }
