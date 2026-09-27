import { motion } from "motion/react"
import { Atom, Calculator, BookOpen, FlaskConical, GraduationCap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { getTutorSubjects } from "@/services/search"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motion"

/** Icon per subject — purely visual; falls back to a generic cap for any subject not in this list. */
const subjectIcons: Record<string, LucideIcon> = {
  Physics: Atom,
  Mathematics: Calculator,
  English: BookOpen,
  Chemistry: FlaskConical,
}

/**
 * Education landing (Master Spec Screen 12) — subject discovery into Tutor
 * Results, which reuses the existing Search page (Phase 6 audit §5) rather
 * than a second dedicated results screen. Individual tutors are first-class
 * listings here; no schools/academies are invented (Prototype Scope §10).
 */
function EducationPage() {
  const subjects = getTutorSubjects()

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

      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-60px" }}
        variants={staggerContainer}
      >
        <Grid cols={4} gap={4}>
          {subjects.map(({ subject, grade }) => (
            <motion.div key={subject} variants={staggerItem}>
              <CategoryCard
                to={`${routes.search}?type=tutor&q=${encodeURIComponent(subject)}`}
                icon={subjectIcons[subject] ?? GraduationCap}
                label={subject}
                description={grade}
              />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { EducationPage }
