/**
 * What a page can say about itself to browsers, search engines and link previews (Phase 9J).
 * Static routes get theirs from `routeSeo.ts`; pages that know more (a business, an article)
 * publish an override through `useSeo` into this tiny external store, and `SeoManager` is the
 * single writer that turns the winning descriptor into <head> tags.
 */
export type Indexing = "index" | "noindex,follow" | "noindex,nofollow"

export interface SeoDescriptor {
  /** Complete document title. */
  title: string
  description: string
  indexing: Indexing
  /** Canonical site path. Omitted on non-indexable pages. */
  canonicalPath?: string
  /** Public site-relative image path (never a blob/data URL). */
  image?: string
  ogType?: "website" | "article"
}

let override: { path: string; seo: SeoDescriptor } | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function subscribeSeo(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSeoOverride() {
  return override
}

/** Registered by a page for its own URL; cleared when that page unmounts so route defaults apply again. */
export function setSeoOverride(path: string, seo: SeoDescriptor) {
  override = { path, seo }
  emit()
}

export function clearSeoOverride(path: string) {
  if (override?.path === path) {
    override = null
    emit()
  }
}
