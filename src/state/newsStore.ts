import { create } from "zustand"
import type { NewsArticle, NewsStatus } from "@/types/news"
import { newsSeed } from "@/data/news"

interface NewsState {
  items: NewsArticle[]
  createItem: (item: NewsArticle) => void
  updateItem: (id: string, patch: Partial<Omit<NewsArticle, "id">>) => void
  setStatus: (id: string, status: NewsStatus) => void
}

/**
 * News & Daily Updates content (Phase 5A/5B). In-memory for this session —
 * no backend, no persistence. One unified store for both News and Daily
 * Updates (distinguished by `kind`), read by the public /news pages, the
 * global Search, and the Admin Content Management screens (Phase 5B) which
 * author and publish directly — there is no separate moderation/review step
 * here, unlike the provider listing lifecycle.
 */
export const useNewsStore = create<NewsState>((set) => ({
  items: newsSeed,

  createItem: (item) => set((state) => ({ items: [item, ...state.items] })),

  updateItem: (id, patch) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch, id } : item)),
    })),

  setStatus: (id, status) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status } : item)),
    })),
}))
