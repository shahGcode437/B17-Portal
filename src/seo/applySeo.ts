import { DEFAULT_SOCIAL_IMAGE, SITE_NAME, SITE_NOINDEX, absoluteUrl } from "@/config/seo"
import type { SeoDescriptor } from "@/seo/seoState"

/**
 * Writes a SeoDescriptor into <head> (Phase 9J) — the one place that touches document metadata.
 * Existing tags (the static defaults in index.html) are updated in place; missing ones are created
 * and marked `data-seo`; optional ones are removed when they do not apply. Nothing here reads
 * private data or stores anything.
 */
function metaSelector(attr: "name" | "property", key: string) {
  return `meta[${attr}="${key}"]`
}

function setMeta(attr: "name" | "property", key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(metaSelector(attr, key))
  if (content === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement("meta")
    el.setAttribute(attr, key)
    el.setAttribute("data-seo", "")
    document.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement("link")
    el.setAttribute("rel", "canonical")
    el.setAttribute("data-seo", "")
    document.head.appendChild(el)
  }
  el.setAttribute("href", href)
}

export function applySeo(seo: SeoDescriptor, pathname: string) {
  const indexing = SITE_NOINDEX ? "noindex,nofollow" : seo.indexing
  const canonical = seo.canonicalPath && !SITE_NOINDEX ? absoluteUrl(seo.canonicalPath) : null
  const image = absoluteUrl(seo.image ?? DEFAULT_SOCIAL_IMAGE)

  document.title = seo.title
  setMeta("name", "description", seo.description)
  // Indexable pages carry no robots tag (indexing is the default); everything else says so explicitly.
  setMeta("name", "robots", indexing === "index" ? null : indexing.replace(",", ", "))
  setCanonical(canonical)

  setMeta("property", "og:site_name", SITE_NAME)
  setMeta("property", "og:type", seo.ogType ?? "website")
  setMeta("property", "og:title", seo.title)
  setMeta("property", "og:description", seo.description)
  setMeta("property", "og:url", canonical ?? absoluteUrl(pathname))
  setMeta("property", "og:image", image)

  setMeta("name", "twitter:card", seo.image ? "summary_large_image" : "summary")
  setMeta("name", "twitter:title", seo.title)
  setMeta("name", "twitter:description", seo.description)
  setMeta("name", "twitter:image", image)
}
