import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NewsCard } from "@/components/cards/NewsCard"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { ResultCardSkeleton } from "@/components/feedback/ResultCardSkeleton"
import { usePagedRead } from "@/hooks/usePagedRead"
import { fetchNewsList } from "@/lib/api/reads/news"
import { toNewsArticle } from "@/lib/api/adapters"
import { newsArticlePath } from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { NewsKind } from "@/types/news"

type KindFilter = "all" | NewsKind

const NEWS_PAGE_SIZE = 12

const filterOptions: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "update", label: "Updates" },
]

/**
 * News & Daily Updates listing (Master Spec Screen 18) - one unified feed from `GET /news`
 * (published items, newest first). The kind filter is the server's `kind` parameter and "Load more"
 * fetches the next server page, so the count and the paging are real.
 */
function NewsListPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<KindFilter>("all")
  const list = usePagedRead(`news:${filter}`, async (offset, signal) => {
    const page = await fetchNewsList(
      { kind: filter === "all" ? undefined : filter, limit: NEWS_PAGE_SIZE, offset },
      signal
    )
    return { items: page.items.map(toNewsArticle), raw: page.items.length, total: page.meta.total, extra: undefined }
  })

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

          {list.loading ? (
            <div role="status" aria-label="Loading news">
              <Grid cols={3} gap={4}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <ResultCardSkeleton key={index} />
                ))}
              </Grid>
            </div>
          ) : list.error ? (
            <ReadError error={list.error} onRetry={list.retry} title="Couldn't load the news" />
          ) : list.items.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description="There's no content for this filter right now. Try a different view."
            />
          ) : (
            <>
              <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                <Grid cols={3} gap={4}>
                  {list.items.map((item) => (
                    <motion.div key={item.id} variants={staggerItem}>
                      <NewsCard article={item} onSelect={() => navigate(newsArticlePath(item.id))} />
                    </motion.div>
                  ))}
                </Grid>
              </motion.div>
              {list.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
                    {list.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {list.moreError && (
                    <Typography variant="body-sm" role="alert" className="text-destructive">
                      Couldn't load more. Try again.
                    </Typography>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { NewsListPage }
