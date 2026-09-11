import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { TutorCard } from "@/components/cards/TutorCard"
import { getFeaturedTutors } from "@/services/search"
import { mapTutorToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { SearchResult } from "@/types/search"

interface EducationPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** Education/Tutor discovery preview (Prototype Scope §10) — individual professionals as first-class listings. */
function EducationPreview({ onSelect }: EducationPreviewProps) {
  const featured = getFeaturedTutors(3)

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader
        title="Education & Tutors"
        description="Schools, academies and individual tutors — like this Physics tutor example."
        viewAllPath={`${routes.search}?type=tutor`}
      />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={staggerContainer}
      >
        <Grid cols={3} gap={4}>
          {featured.map((tutor) => (
            <motion.div key={tutor.id} variants={staggerItem}>
              <TutorCard tutor={tutor} onSelect={() => onSelect(mapTutorToResult(tutor))} />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { EducationPreview }
