import { fetchNews, fetchNewsList } from "@/lib/api/reads/news"
import { toNewsArticle } from "@/lib/api/adapters"
import { useRead, type ReadResult } from "@/hooks/useRead"
import type { NewsArticle } from "@/types/news"

/** Published news and daily updates from `GET /news`, newest first. `total` is the server's count. */
export function useNewsList(limit: number): ReadResult<{ items: NewsArticle[]; total: number }> {
  return useRead(`news:list:${limit}`, async (signal) => {
    const page = await fetchNewsList({ limit }, signal)
    return { items: page.items.map(toNewsArticle), total: page.meta.total }
  })
}

/** One published item from `GET /news/{id}`; anything else (draft, unknown, malformed) is a 404 error. */
export function useNewsItem(id: string | undefined): ReadResult<NewsArticle> {
  return useRead(
    `news:item:${id ?? ""}`,
    async (signal) => toNewsArticle(await fetchNews(id ?? "", signal)),
    { enabled: Boolean(id) }
  )
}
