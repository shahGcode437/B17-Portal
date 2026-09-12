import { create } from "zustand"
import type { NewsArticle } from "@/types/news"
import { newsSeed } from "@/data/news"

interface NewsState {
  items: NewsArticle[]
}

/**
 * News & Daily Updates content (Phase 5A). In-memory for this session — no
 * backend, no persistence. One unified store for both News and Daily
 * Updates (distinguished by `kind`), read by both the public /news pages
 * and the global Search — the single source of truth Phase 5B's Content
 * Admin will also write to.
 */
export const useNewsStore = create<NewsState>(() => ({
  items: newsSeed,
}))
