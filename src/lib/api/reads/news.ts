import { apiRequest, apiRequestPage, type Page } from "@/lib/api/client"
import { queryString, segment } from "@/lib/api/query"
import type { NewsDto, NewsKindDto } from "@/lib/api/dto/public"

export interface NewsParams {
  kind?: NewsKindDto
  limit?: number
  offset?: number
}

/** `GET /news` — published items, newest `publishedAt` first. */
export function fetchNewsList(params: NewsParams = {}, signal?: AbortSignal): Promise<Page<NewsDto>> {
  return apiRequestPage<NewsDto>("GET", `/news${queryString({ ...params })}`, { signal })
}

/** `GET /news/{id}` — a published item (the id is a uuid); `404` otherwise. */
export function fetchNews(id: string, signal?: AbortSignal): Promise<NewsDto> {
  return apiRequest<NewsDto>("GET", `/news/${segment(id)}`, { signal })
}
