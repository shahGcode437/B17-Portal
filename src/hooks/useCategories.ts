import { fetchCategories } from "@/lib/api/reads/categories"
import type { CategoryDto, CategoryModule } from "@/lib/api/dto/public"
import { useRead, type ReadResult } from "@/hooks/useRead"

/**
 * Active categories of one module from `GET /categories` (Phase 12G) — the single source for every
 * category picker, tile grid and filter, so a category an admin adds or deactivates (Phase 12E)
 * shows up without a code change.
 *
 * The answer is shared for the life of the page session (several components ask for the same
 * module at once, and the desktop filter bar and the mobile filter sheet are both mounted). A
 * FAILED request is never remembered, so a retry asks again. The shared request is not tied to any
 * one component's abort signal: a component that unmounts simply ignores the answer.
 */
const cache = new Map<CategoryModule, Promise<CategoryDto[]>>()

function categoriesOf(module: CategoryModule): Promise<CategoryDto[]> {
  let pending = cache.get(module)
  if (!pending) {
    pending = fetchCategories(module)
    cache.set(module, pending)
    pending.catch(() => {
      if (cache.get(module) === pending) cache.delete(module)
    })
  }
  return pending
}

/** Forgets every remembered answer (tests; and anything that knows categories just changed). */
export function resetCategoryCache(): void {
  cache.clear()
}

export function useCategories(module: CategoryModule, options: { enabled?: boolean } = {}): ReadResult<CategoryDto[]> {
  return useRead(`categories:${module}`, () => categoriesOf(module), options)
}
