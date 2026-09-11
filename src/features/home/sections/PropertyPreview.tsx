import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { getFeaturedProperties } from "@/services/search"
import { mapPropertyToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { SearchResult } from "@/types/search"

interface PropertyPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Property discovery preview (Prototype Scope §11) — a mix of sale and rent. */
function PropertyPreview({ onSelect }: PropertyPreviewProps) {
  const featured = getFeaturedProperties(3)

  return (
    <section className="bg-secondary/30">
      <Container className="py-12 sm:py-16">
        <SectionHeader
          title="Property"
          description="Houses, flats and plots for sale or rent in B-17."
          viewAllPath={`${routes.search}?type=property`}
        />
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer}
        >
          <Grid cols={3} gap={4}>
            {featured.map((property) => (
              <motion.div key={property.id} variants={staggerItem}>
                <PropertyCard property={property} onSelect={() => onSelect(mapPropertyToResult(property))} />
              </motion.div>
            ))}
          </Grid>
        </motion.div>
      </Container>
    </section>
  )
}

export { PropertyPreview }
