import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryTiles } from "@/components/cards/CategoryTiles"
import { educationIconFor } from "@/config/categoryIcons"
import { useCategories } from "@/hooks/useCategories"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Education landing (Master Spec Screen 12) - subject discovery from `GET /categories?module=education`
 * into Tutor results, which reuse the Search page. Individual tutors are first-class listings; no
 * schools or academies are invented (Prototype Scope §10).
 */
function EducationPage() {
  const subjects = useCategories("education")

  return (
    <Container className="py-10 sm:py-16">
      <motion.div {...fadeUp}>
        <Stack gap={2} className="mb-8 max-w-2xl">
          <Typography variant="h1">Education & Tutors</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Individual tutors and subject specialists for B-17 students. Browse by subject to find
            the right fit.
          </Typography>
        </Stack>
      </motion.div>

      <CategoryTiles
        read={subjects}
        noun="subjects"
        iconFor={educationIconFor}
        hrefFor={(category) => `${routes.search}?type=tutor&subject=${encodeURIComponent(category.slug)}`}
      />
    </Container>
  )
}

export { EducationPage }
