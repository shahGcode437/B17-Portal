import { ProviderCard } from "@/components/cards/ProviderCard"
import { PreviewSection } from "@/features/home/PreviewSection"
import { featuredFirst, useProviders } from "@/hooks/useListings"
import { mapProviderToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import type { SearchResult } from "@/types/search"

interface FeaturedProvidersProps {
  onSelect: (result: SearchResult) => void
}

/** Featured construction/home-service providers (Prototype Scope §7) - real providers, flagged ones first. */
function FeaturedProviders({ onSelect }: FeaturedProvidersProps) {
  const providers = useProviders(12)

  return (
    <PreviewSection
      title="Featured Providers"
      description="A first look at construction and home-service providers on B-17 Portal."
      viewAllPath={`${routes.search}?type=provider`}
      read={providers}
      cols={4}
      limit={4}
      order={featuredFirst}
      getKey={(provider) => provider.id}
      renderCard={(provider) => <ProviderCard provider={provider} onSelect={() => onSelect(mapProviderToResult(provider))} />}
    />
  )
}

export { FeaturedProviders }
