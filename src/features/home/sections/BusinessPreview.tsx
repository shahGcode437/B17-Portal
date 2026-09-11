import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { getFeaturedBusinesses } from "@/services/search"
import { mapBusinessToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { SearchResult } from "@/types/search"

interface BusinessPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Business Directory preview (Prototype Scope §9). */
function BusinessPreview({ onSelect }: BusinessPreviewProps) {
  const featured = getFeaturedBusinesses(4)

  return (
    <section className="bg-secondary/30">
      <Container className="py-12 sm:py-16">
        <SectionHeader
          title="Business Directory"
          description="Local businesses and professionals serving B-17."
          viewAllPath={`${routes.search}?type=business`}
        />
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer}
        >
          <Grid cols={4} gap={4}>
            {featured.map((business) => (
              <motion.div key={business.id} variants={staggerItem}>
                <BusinessCard business={business} onSelect={() => onSelect(mapBusinessToResult(business))} />
              </motion.div>
            ))}
          </Grid>
        </motion.div>
      </Container>
    </section>
  )
}

export { BusinessPreview }
