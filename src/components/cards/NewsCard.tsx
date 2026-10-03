import { Calendar, Newspaper } from "lucide-react"
import { motion } from "motion/react"
import type { NewsArticle } from "@/types/news"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { CardImage } from "@/components/media/CardImage"
import { Badge } from "@/components/ui/badge"
import { cardHover } from "@/lib/motion"

interface NewsCardProps {
  article: NewsArticle
  onSelect?: () => void
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

/** News/update card (Master Spec §11): image/label, title, time/category. */
function NewsCard({ article, onSelect }: NewsCardProps) {
  return (
    <motion.div
      {...cardHover}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Read ${article.title}`}
    >
      <CardImage src={article.image} icon={Newspaper} label={article.title} tone="accent" />
      <Stack gap={2} className="px-1 pb-1">
        <Stack direction="row" align="center" gap={2}>
          <Badge variant={article.kind === "update" ? "secondary" : "default"}>{article.category}</Badge>
          <Stack direction="row" align="center" gap={1} className="text-muted-foreground">
            <Calendar className="size-3.5" aria-hidden="true" />
            <Typography variant="caption">{dateFormatter.format(new Date(article.publishedAt))}</Typography>
          </Stack>
        </Stack>
        <Typography variant="label" className="text-base">
          {article.title}
        </Typography>
        <Typography variant="body-sm" className="text-muted-foreground line-clamp-2">
          {article.summary}
        </Typography>
      </Stack>
    </motion.div>
  )
}

export { NewsCard }
