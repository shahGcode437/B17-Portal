import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NewsCard } from "@/components/cards/NewsCard"
import { EmptyState } from "@/components/feedback/EmptyState"
import { getLatestNews } from "@/services/search"
import { newsArticlePath } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { NewsKind } from "@/types/news"

type KindFilter = "all" | NewsKind

const filterOptions: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "update", label: "Updates" },
]

/** News & Daily Updates listing (Master Spec Screen 18) — one unified feed, filterable by kind. */
function NewsListPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<KindFilter>("all")

  const items = getLatestNews()
  const visible = useMemo(
    () => items.filter((item) => filter === "all" || item.kind === filter),
    [items, filter]
  )

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp}>
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1">News & Daily Updates</Typography>
            <Typography variant="body" className="text-muted-foreground">
              Local development, infrastructure and community updates for B-17.
            </Typography>
          </Stack>

          <ToggleGroup
            type="single"
            variant="outline"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as KindFilter)
            }}
            aria-label="Filter by content type"
          >
            {filterOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {visible.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description="There's no content for this filter right now. Try a different view."
            />
          ) : (
            <motion.div initial="initial" animate="animate" variants={staggerContainer}>
              <Grid cols={3} gap={4}>
                {visible.map((item) => (
                  <motion.div key={item.id} variants={staggerItem}>
                    <NewsCard article={item} onSelect={() => navigate(newsArticlePath(item.id))} />
                  </motion.div>
                ))}
              </Grid>
            </motion.div>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { NewsListPage }
