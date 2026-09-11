import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { getFeaturedProviders } from "@/services/search"
import { mapProviderToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { SearchResult } from "@/types/search"

interface FeaturedProvidersProps {
  onSelect: (result: SearchResult) => void
}

/** Featured construction/home-service providers (Prototype Scope §7). */
function FeaturedProviders({ onSelect }: FeaturedProvidersProps) {
  const featured = getFeaturedProviders(4)

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader
        title="Featured Providers"
        description="A first look at construction and home-service providers on B-17 Portal."
        viewAllPath={`${routes.search}?type=provider`}
      />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={staggerContainer}
      >
        <Grid cols={4} gap={4}>
          {featured.map((provider) => (
            <motion.div key={provider.id} variants={staggerItem}>
              <ProviderCard provider={provider} onSelect={() => onSelect(mapProviderToResult(provider))} />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { FeaturedProviders }
