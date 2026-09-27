import { motion } from "motion/react"
import { Tag, KeyRound, Home, Building2, LandPlot } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { getPropertyListingTypes, getPropertyTypes } from "@/services/search"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motion"
import type { ListingType } from "@/types/property"

const listingTypeMeta: Record<ListingType, { label: string; icon: LucideIcon }> = {
  sale: { label: "Sale", icon: Tag },
  rent: { label: "Rent", icon: KeyRound },
}

const propertyTypeIcons: Record<string, LucideIcon> = {
  House: Home,
  Flat: Building2,
  Plot: LandPlot,
}

/** Pairs each real listing type (Sale/Rent) with its display label/icon, in seed order. */
function getListingTypeTiles() {
  return getPropertyListingTypes().map((value) => ({ value, ...listingTypeMeta[value] }))
}

/** Pairs each real property type (House/Flat/Plot) with its display icon, in seed order. */
function getPropertyTypeTiles() {
  return getPropertyTypes().map((value) => ({ value, icon: propertyTypeIcons[value] ?? Home }))
}

/**
 * Property landing (Master Spec Screen 15) — Sale/Rent and House/Flat/Plot
 * discovery into Property Results, which reuses the existing Search page
 * (Phase 6 audit §5/§8) rather than a second dedicated results screen.
 */
function PropertyPage() {
  const listingTypes = getListingTypeTiles()
  const propertyTypes = getPropertyTypeTiles()

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
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
          >
            <Grid cols={2} gap={4}>
              {listingTypes.map(({ value, label, icon }) => (
                <motion.div key={value} variants={staggerItem}>
                  <CategoryCard
                    to={`${routes.search}?type=property&q=${encodeURIComponent(label)}`}
                    icon={icon}
                    label={label}
                  />
                </motion.div>
              ))}
            </Grid>
          </motion.div>
        </Stack>

        <Stack gap={3}>
          <Typography variant="label">Property Type</Typography>
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
          >
            <Grid cols={4} gap={4}>
              {propertyTypes.map(({ value, icon }) => (
                <motion.div key={value} variants={staggerItem}>
                  <CategoryCard
                    to={`${routes.search}?type=property&q=${encodeURIComponent(value)}`}
                    icon={icon}
                    label={value}
                  />
                </motion.div>
              ))}
            </Grid>
          </motion.div>
        </Stack>
      </Stack>
    </Container>
  )
}

export { PropertyPage }
