import { MapPin, BedDouble, KeyRound } from "lucide-react"
import type { Property } from "@/types/property"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { DemoBadge } from "@/components/feedback/DemoBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SaveButton } from "@/components/inputs/SaveButton"
import { useToast } from "@/hooks/useToast"
import { SIMULATED_MESSAGES } from "@/lib/simulatedActions"

interface PropertyCardProps {
  property: Property
  onSelect?: () => void
}

/** Property card (Master Spec §11): image, sale/rent, price, type, location, key facts. */
function PropertyCard({ property, onSelect }: PropertyCardProps) {
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
        <SaveButton kind="property" id={property.id} name={property.title} className="absolute right-2 top-2" />
      </div>
      <Stack gap={2} className="px-1">
        <Stack direction="row" justify="between" align="start" gap={2}>
          <Typography variant="label" className="line-clamp-2 text-base">
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
    </Card>
  )
}

export { PropertyCard }
