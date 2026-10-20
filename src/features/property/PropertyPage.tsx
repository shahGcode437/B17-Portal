import { motion } from "motion/react"
import { Tag, KeyRound, Home, Building2, LandPlot } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { CategoryTiles } from "@/components/cards/CategoryTiles"
import { useCategories } from "@/hooks/useCategories"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motion"

/** Sale / Rent is a closed set of the product (`listingType`), not taxonomy data. */
const LISTING_TYPES: { value: "sale" | "rent"; label: string; icon: LucideIcon }[] = [
  { value: "sale", label: "Sale", icon: Tag },
  { value: "rent", label: "Rent", icon: KeyRound },
]

/** Visual only; the property types themselves (names, order) come from `GET /categories?module=property`. */
const PROPERTY_TYPE_ICONS: Record<string, LucideIcon> = {
  house: Home,
  flat: Building2,
  plot: LandPlot,
}

/**
 * Property landing (Master Spec Screen 15) - Sale/Rent and the property types from
 * `GET /categories?module=property`, leading into Property results (the Search page).
 */
function PropertyPage() {
  const propertyTypes = useCategories("property")

  return (
    <Container className="py-10 sm:py-16">
      <motion.div {...fadeUp}>
        <Stack gap={2} className="mb-8 max-w-2xl">
          <Typography variant="h1">Property</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Houses, flats and plots for sale or rent in B-17. Browse by listing type or property
            type to get started.
          </Typography>
        </Stack>
      </motion.div>

      <Stack gap={8}>
        <Stack gap={3}>
          <Typography variant="label">Sale or Rent</Typography>
          <motion.div initial="initial" animate="animate" variants={staggerContainer}>
            <Grid cols={2} gap={4}>
              {LISTING_TYPES.map(({ value, label, icon }) => (
                <motion.div key={value} variants={staggerItem}>
                  <CategoryCard to={`${routes.search}?type=property&listingType=${value}`} icon={icon} label={label} />
                </motion.div>
              ))}
            </Grid>
          </motion.div>
        </Stack>

        <Stack gap={3}>
          <Typography variant="label">Property Type</Typography>
          <CategoryTiles
            read={propertyTypes}
            noun="property types"
            iconFor={(slug) => PROPERTY_TYPE_ICONS[slug] ?? Home}
            hrefFor={(category) => `${routes.search}?type=property&propertyType=${encodeURIComponent(category.slug)}`}
          />
        </Stack>
      </Stack>
    </Container>
  )
}

export { PropertyPage }
