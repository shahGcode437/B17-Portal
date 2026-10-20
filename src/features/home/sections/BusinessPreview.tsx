import { BusinessCard } from "@/components/cards/BusinessCard"
import { PreviewSection } from "@/features/home/PreviewSection"
import { featuredFirst, useBusinesses } from "@/hooks/useListings"
import { mapBusinessToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import type { SearchResult } from "@/types/search"

interface BusinessPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Business Directory preview (Prototype Scope §9) - real businesses, flagged ones first. */
function BusinessPreview({ onSelect }: BusinessPreviewProps) {
  const businesses = useBusinesses(12)

  return (
    <PreviewSection
      title="Business Directory"
      description="Local businesses and professionals serving B-17."
      viewAllPath={`${routes.search}?type=business`}
      read={businesses}
      cols={4}
      limit={4}
      order={featuredFirst}
      tinted
      getKey={(business) => business.id}
      renderCard={(business) => <BusinessCard business={business} onSelect={() => onSelect(mapBusinessToResult(business))} />}
    />
  )
}

export { BusinessPreview }
