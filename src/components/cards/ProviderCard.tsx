import { Wrench } from "lucide-react"
import { useNavigate } from "react-router-dom"
import type { Provider } from "@/types/provider"
import { Button } from "@/components/ui/button"
import { ListingCardShell } from "@/components/cards/ListingCardShell"
import { tagFacts } from "@/components/cards/cardFacts"
import { providerProfilePath } from "@/config/routes"

interface ProviderCardProps {
  provider: Provider
  onSelect?: () => void
}

/** Provider card: name, category, services, coverage area and the one real action (Request). */
function ProviderCard({ provider, onSelect }: ProviderCardProps) {
  const navigate = useNavigate()

  return (
    <ListingCardShell
      kind="provider"
      id={provider.id}
      name={provider.name}
      typeLabel="Service provider"
      typeIcon={Wrench}
      image={provider.image}
      featured={provider.featured}
      title={provider.name}
      subtitle={provider.categoryLabel}
      description={provider.description}
      facts={tagFacts(provider.tags)}
      area={provider.area}
      onSelect={onSelect}
      footer={
        <Button
          size="lg"
          className="h-10 w-full text-sm"
          onClick={(e) => {
            e.stopPropagation()
            navigate(providerProfilePath(provider.id))
          }}
        >
          Request
        </Button>
      }
    />
  )
}

export { ProviderCard }
