import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import {
  Coffee,
  Cookie,
  CookingPot,
  CupSoda,
  Flame,
  IceCreamCone,
  Pizza,
  Sandwich,
  Soup,
  Utensils,
  UtensilsCrossed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { SearchBar } from "@/components/inputs/SearchBar"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Button } from "@/components/ui/button"
import { FOOD_CATEGORIES, FOOD_SERVICE_OPTIONS } from "@/config/food"
import type { FoodCategorySlug, FoodServiceOption } from "@/config/food"
import { routes, businessProfilePath } from "@/config/routes"
import { serviceIcons } from "@/features/food/foodIcons"
import { getFoodBusinesses } from "@/services/search"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"

/** Purely visual icon per category. Exhaustive on purpose: adding a taxonomy category forces a choice here. */
const categoryIcons: Record<FoodCategorySlug, LucideIcon> = {
  restaurants: UtensilsCrossed,
  "fast-food": Sandwich,
  "biryani-rice": CookingPot,
  bbq: Flame,
  "pizza-burgers": Pizza,
  cafes: Coffee,
  "juice-shakes": CupSoda,
  bakeries: Cookie,
  "sweets-desserts": IceCreamCone,
  "desi-food": Soup,
  "tea-snacks": Utensils,
}

/**
 * Every Food entry point goes into the EXISTING Search page — this page owns
 * no results, ranking, filtering or URL logic of its own. The contract is the
 * frozen one: type=business, vertical=food, plus optional q / foodCategory /
 * service (docs/product/FOOD_DINING.md §6).
 */
function foodSearchPath(params: { q?: string; foodCategory?: FoodCategorySlug; service?: FoodServiceOption } = {}): string {
  const search = new URLSearchParams({ type: "business", vertical: "food" })
  if (params.q) search.set("q", params.q)
  if (params.foodCategory) search.set("foodCategory", params.foodCategory)
  if (params.service) search.set("service", params.service)
  return `${routes.search}?${search.toString()}`
}

/**
 * Food & Dining discovery landing (FD2). Follows the established category
 * landing pattern (Services / Directory / Education / Property): a title, a
 * scoped search entry and config-driven tiles that link into Search. Food
 * businesses stay ordinary Business records and open at /businesses/:id.
 */
function FoodPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  // Real data only: records flagged `featured` sort first (and BusinessCard shows its own Featured
  // badge for them), but the section itself is neutral — nothing is promoted that isn't flagged.
  const foodBusinesses = getFoodBusinesses(4)

  function runSearch(value: string) {
    navigate(foodSearchPath({ q: value.trim() || undefined }))
  }

  return (
    <Container className="py-10 sm:py-16">
      <Stack gap={12}>
        <motion.div {...fadeUp}>
          <Stack gap={6} className="max-w-2xl">
            <Stack gap={2}>
              <Typography variant="h1">Food & Dining</Typography>
              <Typography variant="body" className="text-muted-foreground">
                Restaurants, cafes, bakeries and more in B-17. Search or browse by what you're in the
                mood for, then contact the business directly.
              </Typography>
            </Stack>
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={runSearch}
              size="hero"
              label="Search Food & Dining"
              placeholder="Search food & dining — e.g. biryani, cafe, cake"
            />
          </Stack>
        </motion.div>

        <section aria-label="Browse by category">
          <SectionHeader title="Browse by category" />
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
          >
            <Grid cols={4} gap={4}>
              {FOOD_CATEGORIES.map((category) => (
                <motion.div key={category.slug} variants={staggerItem}>
                  <CategoryCard
                    to={foodSearchPath({ foodCategory: category.slug })}
                    icon={categoryIcons[category.slug]}
                    label={category.label}
                  />
                </motion.div>
              ))}
            </Grid>
          </motion.div>
        </section>

        <section aria-label="Browse by service">
          <SectionHeader title="Browse by service" className="mb-4" />
          <Stack direction="row" wrap gap={3}>
            {FOOD_SERVICE_OPTIONS.map((option) => {
              const Icon = serviceIcons[option.value]
              return (
                <Button key={option.value} asChild variant="outline" className="h-11 px-4">
                  <Link to={foodSearchPath({ service: option.value })}>
                    <Icon />
                    {option.label}
                  </Link>
                </Button>
              )
            })}
          </Stack>
          <Typography variant="caption" className="mt-3 block">
            Delivery, where offered, is arranged directly by the business — B-17 Portal does not deliver.
          </Typography>
        </section>

        <section aria-label="Food businesses in B-17">
          <SectionHeader
            title="Food businesses in B-17"
            description="A few places to start — open one to see its details and contact it."
            viewAllPath={foodSearchPath()}
          />
          {foodBusinesses.length === 0 ? (
            <EmptyState
              icon={Utensils}
              title="No food businesses yet"
              description="Food & Dining listings will appear here once they're available."
              actionLabel="Browse the Directory"
              onAction={() => navigate(routes.directory)}
            />
          ) : (
            <motion.div
              initial="initial"
              whileInView="animate"
              viewport={{ once: true, margin: "-60px" }}
              variants={staggerContainer}
            >
              <Grid cols={4} gap={4}>
                {foodBusinesses.map((business) => (
                  <motion.div key={business.id} variants={staggerItem}>
                    <BusinessCard business={business} onSelect={() => navigate(businessProfilePath(business.id))} />
                  </motion.div>
                ))}
              </Grid>
            </motion.div>
          )}
        </section>
      </Stack>
    </Container>
  )
}

export { FoodPage }
