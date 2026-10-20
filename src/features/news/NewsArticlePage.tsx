import { useParams, useNavigate, Link } from "react-router-dom"
import { motion } from "motion/react"
import { Calendar, Newspaper } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { DetailHero } from "@/components/detail/DetailHero"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { DetailSkeleton } from "@/components/detail/ListingDetailGate"
import { useNewsItem } from "@/hooks/useNews"
import { useSeo } from "@/hooks/useSeo"
import { newsSeo } from "@/seo/entitySeo"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
})

/**
 * News/Update detail (Master Spec Screen 19) — one shared page for both
 * kinds; only the badge label and tint differ (Phase 5A audit §3).
 */
function NewsArticlePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const read = useNewsItem(id)
  const article = read.status === "success" ? read.data : undefined
  useSeo(newsSeo(article))

  if (read.status === "loading") return <DetailSkeleton />
  if (read.status === "error" && read.error.status !== 404) {
    return (
      <Container className="py-16">
        <ReadError error={read.error} onRetry={read.retry} headingLevel={1} />
      </Container>
    )
  }

  if (!article) {
    return (
      <Container className="py-16">
        <EmptyState
          headingLevel={1}
          icon={Newspaper}
          title="Content not found"
          description="This news item or update doesn't exist or may no longer be available."
          actionLabel="Back to News & Daily Updates"
          onAction={() => navigate(routes.news)}
        />
      </Container>
    )
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link to={routes.news}>Back to News & Daily Updates</Link>
          </Button>

          <DetailHero src={article.image} icon={Newspaper} label={article.title} tone="accent" />

          <Stack gap={3}>
            <Stack direction="row" align="center" wrap gap={2}>
              <Badge variant={article.kind === "update" ? "secondary" : "default"}>
                {article.kind === "update" ? "Update" : "News"}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {article.category}
              </Badge>
              <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
                <Calendar className="size-3.5" aria-hidden="true" />
                <Typography variant="caption">
                  {dateFormatter.format(new Date(article.publishedAt))}
                </Typography>
              </Stack>
            </Stack>

            <Typography variant="h1" className="text-balance">
              {article.title}
            </Typography>

            <Typography variant="body-lg" className="text-muted-foreground">
              {article.summary}
            </Typography>
          </Stack>

          {article.tags.length > 0 && (
            <Stack direction="row" wrap gap={2}>
              {article.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { NewsArticlePage }
