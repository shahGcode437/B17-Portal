import { NewsCard } from "@/components/cards/NewsCard"
import { PreviewSection } from "@/features/home/PreviewSection"
import { useNewsList } from "@/hooks/useNews"
import { mapNewsToResult } from "@/services/mappers"
import { routes } from "@/config/routes"
import type { SearchResult } from "@/types/search"

interface NewsPreviewProps {
  onSelect: (result: SearchResult) => void
}

/** News & Daily Updates preview (Prototype Scope §12) - the newest published items. */
function NewsPreview({ onSelect }: NewsPreviewProps) {
  const news = useNewsList(3)

  return (
    <PreviewSection
      title="News & Daily Updates"
      description="Local development, infrastructure and community updates."
      viewAllPath={routes.news}
      read={news}
      cols={3}
      limit={3}
      getKey={(article) => article.id}
      renderCard={(article) => <NewsCard article={article} onSelect={() => onSelect(mapNewsToResult(article))} />}
    />
  )
}

export { NewsPreview }
