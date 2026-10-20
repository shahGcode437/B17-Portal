import { apiRequest } from "@/lib/api/client"
import { queryString } from "@/lib/api/query"
import type { CategoryDto, CategoryModule } from "@/lib/api/dto/public"

/** `GET /categories?module=` — ACTIVE categories only, ordered by module, display order, slug. */
export function fetchCategories(module?: CategoryModule, signal?: AbortSignal): Promise<CategoryDto[]> {
  return apiRequest<CategoryDto[]>("GET", `/categories${queryString({ module })}`, { signal })
}
