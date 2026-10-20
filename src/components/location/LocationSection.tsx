import { Landmark, MapPin, Signpost } from "lucide-react"
import { DetailSection } from "@/components/detail/DetailSection"
import { DetailFacts, type DetailFact } from "@/components/detail/DetailFacts"
import { DirectionsButton } from "@/components/location/DirectionsButton"
import { MapView } from "@/components/location/MapView"
import type { MapEngine } from "@/components/location/mapEngine"
import { Typography } from "@/components/foundation/Typography"
import type { PublicLocation } from "@/types/location"

interface LocationSectionProps {
  /** The listing's name. */
  name: string
  /** The listing's `area` text (always public). */
  area: string
  /** Absent on legacy records: treated exactly like an area-only listing. */
  location: PublicLocation | undefined
  /** A section heading for a service that covers an area rather than sitting at a point. */
  title?: string
  engine?: MapEngine
}

/**
 * The detail-page "Location" block, one implementation for Business, Food, Property, Tutor and
 * Provider (docs/backend/LOCATION_MAP.md §11.1). It receives the PUBLIC location only:
 *
 *  - exact: address, landmark and block as text, a pin on the map, and Get Directions;
 *  - approximate: "Approximate location" with the block and a labelled illustrative circle — no
 *    address, no directions, no claim of precision;
 *  - area-only (and legacy / missing): the area (and block) as text. No map, no pin, no directions.
 */
function LocationSection({ name, area, location, title = "Location", engine }: LocationSectionProps) {
  const visibility = location?.visibility ?? "area_only"
  const facts: DetailFact[] = []
  if (visibility === "exact" && location?.address) {
    facts.push({ icon: MapPin, label: "Address", value: location.address, wide: true })
  }
  if (visibility === "exact" && location?.landmark) {
    facts.push({ icon: Landmark, label: "Landmark", value: location.landmark, wide: true })
  }
  facts.push({ icon: MapPin, label: "Area", value: area })
  if (location?.block) facts.push({ icon: Signpost, label: "Block", value: location.block })

  return (
    <DetailSection title={visibility === "approximate" ? "Approximate location" : title}>
      {visibility === "area_only" && (
        <Typography variant="body-sm" className="text-muted-foreground">
          Location shared at area level.
        </Typography>
      )}
      {visibility === "approximate" && (
        <Typography variant="body-sm" className="text-muted-foreground">
          The owner shares only a general area. The circle on the map is illustrative, not an exact address.
        </Typography>
      )}
      <DetailFacts facts={facts} />
      {location && <MapView location={location} label={name} engine={engine} />}
      <DirectionsButton location={location} name={name} className="w-full sm:w-auto" />
    </DetailSection>
  )
}

export { LocationSection }
