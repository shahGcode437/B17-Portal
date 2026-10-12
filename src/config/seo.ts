/**
 * Central SEO configuration (Phase 9J). Everything that names the site, builds an absolute
 * URL or decides whether the site may be indexed lives here — nothing else in the app
 * hard-codes a domain.
 *
 * Production URL strategy: no production domain is configured yet, so none is hard-coded.
 * - `VITE_SITE_URL` (build-time, e.g. "https://example.org", no trailing slash) is the single
 *   place to set it. When present it drives canonical / og:url / og:image URLs and the build
 *   generates `sitemap.xml` + the robots.txt `Sitemap:` line (see `vite.config.ts`).
 * - When absent, absolute URLs fall back to the origin the page is actually served from
 *   (correct for any preview / staging host, and never a wrong domain).
 * - `VITE_SITE_NOINDEX=true` forces `noindex, nofollow` on every route — use it for staging /
 *   demo deployments, because all current listing data is fictional demo content.
 */
export const SITE_NAME = "B-17 Portal"

/** Core positioning — descriptive, no superlatives or unsupported claims. */
export const SITE_DESCRIPTION =
  "A hyperlocal platform for discovering services, businesses, food, education, property and local updates in B-17, Islamabad."

export const HOME_TITLE = `${SITE_NAME} | Local Services, Property, Food & More`

/** The only brand image in the repo suited to a social card: the app icon (square, so the "summary" card type). */
export const DEFAULT_SOCIAL_IMAGE = "/icons/icon-512.png"

const configuredSiteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim().replace(/\/+$/, "") || ""

export const SITE_NOINDEX = import.meta.env.VITE_SITE_NOINDEX === "true"

/** The configured production URL, else the current origin. */
export function siteUrl(): string {
  return configuredSiteUrl || window.location.origin
}

/** Absolute URL for a site path ("/food") or a public asset path ("/images/x.jpg"). */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`
}

/** "Name | B-17 Portal" — keeps every detail title in one consistent shape. */
export function pageTitle(name: string): string {
  return `${name} | ${SITE_NAME}`
}

/** Collapses whitespace and trims to a meta-description length at a word boundary. */
export function summarize(text: string | undefined, fallback: string, max = 155): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim()
  if (!clean) return fallback
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : cut.length).replace(/[.,;:!\s]+$/, "")}…`
}

/** Only real, public, site-relative image paths are usable as social images (never blob: previews or data URLs). */
export function publicImagePath(image: string | undefined): string | undefined {
  return image && image.startsWith("/") && !image.startsWith("//") ? image : undefined
}
