import { motion } from "motion/react"
import { Pill, Scissors, Shirt, ShoppingBasket, Car, Cookie, Dumbbell, Building2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { getBusinessCategories } from "@/services/search"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motion"

/** Icon per category — purely visual; falls back to a generic building for any category not in this list. */
const categoryIcons: Record<string, LucideIcon> = {
  Pharmacy: Pill,
  Hairdressing: Scissors,
  Tailoring: Shirt,
  Grocery: ShoppingBasket,
  Automotive: Car,
  Bakery: Cookie,
  Fitness: Dumbbell,
}

/** Pairs each real business category with its display icon, in seed order. */
function getCategoryTiles() {
  return getBusinessCategories("general").map((category) => ({
    category,
    icon: categoryIcons[category] ?? Building2,
  }))
}

/**
 * Business Directory landing (Master Spec Screen 10) — category discovery
 * into Business Results, which reuses the existing Search page (established
 * pattern from Services/Education/Property) rather than a second dedicated
 * results screen.
 */
function DirectoryPage() {
  const categories = getCategoryTiles()

  return (
    <Container className="py-10 sm:py-16">
      <motion.div {...fadeUp}>
        <Stack gap={2} className="mb-8 max-w-2xl">
          <Typography variant="h1">Business Directory</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Local businesses and professionals serving B-17. Browse by category to find what you
            need.
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
          {categories.map(({ category, icon }) => (
            <motion.div key={category} variants={staggerItem}>
              <CategoryCard
                to={`${routes.search}?type=business&q=${encodeURIComponent(category)}`}
                icon={icon}
                label={category}
              />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { DirectoryPage }
