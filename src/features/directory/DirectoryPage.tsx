import { motion } from "motion/react"
import { Utensils } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { CategoryTiles } from "@/components/cards/CategoryTiles"
import { directoryIconFor } from "@/config/categoryIcons"
import { useCategories } from "@/hooks/useCategories"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Business Directory landing (Master Spec Screen 10) - the general-business categories from
 * `GET /categories?module=directory`, each leading into Search (the established pattern) rather than
 * a second results screen. Food & Dining is its own vertical (see /food): one entry here, and its
 * categories are not repeated below.
 */
function DirectoryPage() {
  const categories = useCategories("directory")

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

      <CategoryTiles
        read={categories}
        noun="business categories"
        iconFor={directoryIconFor}
        hrefFor={(category) =>
          `${routes.search}?type=business&vertical=general&category=${encodeURIComponent(category.slug)}`
        }
        leading={
          <motion.div>
            <CategoryCard
              to={routes.food}
              icon={Utensils}
              label="Food & Dining"
              description="Restaurants, cafes, bakeries and more"
              emphasis
            />
          </motion.div>
        }
      />
    </Container>
  )
}

export { DirectoryPage }
