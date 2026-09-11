import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { serviceCategories } from "@/data/serviceCategories"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motion"

/**
 * Services landing (Prototype Scope §8) — every construction/home-service
 * category, each linking into the existing provider-filtered Search rather
 * than a separate results page (Master Spec §15 — no duplicate architecture).
 */
function ServicesPage() {
  return (
    <Container className="py-10 sm:py-16">
      <motion.div {...fadeUp}>
        <Stack gap={2} className="mb-8 max-w-2xl">
          <Typography variant="h1">Home & Construction Services</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Browse every category to see B-17 providers offering that service.
          </Typography>
        </Stack>
      </motion.div>

      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-60px" }}
        variants={staggerContainer}
      >
        <Grid cols={4} gap={4}>
          {serviceCategories.map((category) => (
            <motion.div key={category.slug} variants={staggerItem}>
              <CategoryCard
                to={`${routes.search}?type=provider&q=${encodeURIComponent(category.label)}`}
                icon={category.icon}
                label={category.label}
              />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { ServicesPage }
