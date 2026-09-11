import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { NewsCard } from "@/components/cards/NewsCard"
import { getLatestNews } from "@/services/search"
import { mapNewsToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import { staggerContainer, staggerItem } from "@/lib/motion"
import type { SearchResult } from "@/types/search"

interface NewsPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** News & Daily Updates preview (Prototype Scope §12). */
function NewsPreview({ onSelect }: NewsPreviewProps) {
  const latest = getLatestNews(3)

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeader
        title="News & Daily Updates"
        description="Local development, infrastructure and community updates."
        viewAllPath={`${routes.search}?type=news`}
      />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={staggerContainer}
      >
        <Grid cols={3} gap={4}>
          {latest.map((article) => (
            <motion.div key={article.id} variants={staggerItem}>
              <NewsCard article={article} onSelect={() => onSelect(mapNewsToResult(article))} />
            </motion.div>
          ))}
        </Grid>
      </motion.div>
    </Container>
  )
}

export { NewsPreview }
