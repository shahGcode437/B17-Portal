export type NewsKind = "news" | "update"

/** A news article or daily update. Fictional prototype content only. */
export interface NewsArticle {
  id: string
  kind: NewsKind
  title: string
  category: string
  summary: string
  image?: string
  publishedAt: string
  tags: string[]
}
