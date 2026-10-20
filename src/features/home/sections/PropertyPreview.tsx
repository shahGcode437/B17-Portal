import { PropertyCard } from "@/components/cards/PropertyCard"
import { PreviewSection } from "@/features/home/PreviewSection"
import { useProperties } from "@/hooks/useListings"
import { mapPropertyToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import type { SearchResult } from "@/types/search"

interface PropertyPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Property discovery preview (Prototype Scope §11) - real approved properties. */
function PropertyPreview({ onSelect }: PropertyPreviewProps) {
  const properties = useProperties(3)

  return (
    <PreviewSection
      title="Property"
      description="Houses, flats and plots for sale or rent in B-17."
      viewAllPath={`${routes.search}?type=property`}
      read={properties}
      cols={3}
      limit={3}
      tinted
      getKey={(property) => property.id}
      renderCard={(property) => <PropertyCard property={property} onSelect={() => onSelect(mapPropertyToResult(property))} />}
    />
  )
}

export { PropertyPreview }
