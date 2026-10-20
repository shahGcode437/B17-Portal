import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryTiles } from "@/components/cards/CategoryTiles"
import { serviceIconFor } from "@/config/categoryIcons"
import { useCategories } from "@/hooks/useCategories"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Services landing (Prototype Scope §8) - every active service category from `GET /categories`,
 * each linking into the provider-filtered Search rather than a separate results page (Master Spec
 * §15 - no duplicate architecture).
 */
function ServicesPage() {
  const categories = useCategories("services")

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

      <CategoryTiles
        read={categories}
        noun="service categories"
        iconFor={serviceIconFor}
        hrefFor={(category) => `${routes.search}?type=provider&category=${encodeURIComponent(category.slug)}`}
      />
    </Container>
  )
}

export { ServicesPage }
