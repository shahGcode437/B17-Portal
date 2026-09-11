import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { discoveryCategories } from "@/data/discoveryCategories"
import { staggerContainer, staggerItem } from "@/lib/motion"

/** Quick Discovery categories (Prototype Scope §7) — the major portal areas. */
function QuickCategories() {
  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader title="Explore B-17 Portal" description="Everything local, in one place." />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={staggerContainer}
      >
        <Grid cols={5} gap={4}>
          {discoveryCategories.map((category) => (
            <motion.div key={category.label} variants={staggerItem}>
              <CategoryCard
                to={category.path}
                icon={category.icon}
                label={category.label}
                description={category.description}
                emphasis={category.emphasis}
              />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { QuickCategories }
