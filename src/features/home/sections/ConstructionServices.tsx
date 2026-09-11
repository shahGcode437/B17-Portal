import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { serviceCategories } from "@/data/serviceCategories"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"

/**
 * Construction/Home Services categories (Project Overview §4) — the
 * client's initial supply focus, given strong homepage prominence.
 */
function ConstructionServices() {
  return (
    <section className="bg-secondary/30">
      <Container className="py-12 sm:py-16">
        <SectionHeader
          title="Home & Construction Services"
          description="Our strongest local supply — construction and home-related providers."
          viewAllPath={routes.services}
        />
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-80px" }}
          variants={staggerContainer}
        >
          <Grid cols={5} gap={3}>
            {serviceCategories.map((category) => (
              <motion.div key={category.slug} variants={staggerItem}>
                <CategoryCard
                  to={`${routes.search}?type=provider&q=${encodeURIComponent(category.label)}`}
                  icon={category.icon}
                  label={category.label}
                  compact
                />
              </motion.div>
            ))}
          </Grid>
        </motion.div>
      </Container>
    </section>
  )
}

export { ConstructionServices }
