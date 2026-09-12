export type NewsKind = "news" | "update"

export type NewsStatus = "draft" | "published"

/**
 * A news article or daily update — one unified content model (Phase 5A).
 * `kind` distinguishes editorial News from operational Daily Updates; both
 * share this same shape and the same /news listing + /news/:id detail page.
 * Fictional prototype content only.
 */
export interface NewsArticle {
  id: string
  kind: NewsKind
  status: NewsStatus
  title: string
  category: string
  summary: string
  image?: string
  publishedAt: string
  tags: string[]
}
