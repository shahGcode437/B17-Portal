/**
 * Full-page navigation, behind a function so tests can stub it (jsdom cannot navigate). Used only
 * for the backend-issued Google `authorizationUrl`, which the SPA never stores, shows or logs.
 */
export function assignLocation(url: string): void {
  window.location.assign(url)
}

/** The names one machine answers to. Cookies treat each as a DIFFERENT host. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * The one case where a Google round trip is certain to fail, detected before the browser leaves.
 *
 * The backend binds the flow to this browser with a host-only cookie set by the `start` call, so the
 * provider's `redirect_uri` must be on the SAME host the SPA called. Local development has two names
 * for one machine: opened at `localhost`, the cookie is stored for `localhost`, the callback goes to
 * `127.0.0.1` without it, and the sign-in ends in `oauth_failed` every time (AUTH_RBAC.md §5.1).
 *
 * Returns this page's address on the callback's host, or `null` when there is nothing to fix. Only
 * two DIFFERENT LOOPBACK hosts qualify, so a deployed site (same origin, or a frontend and an API on
 * different hosts of one domain) is never affected. Ports are ignored: cookies are not port-scoped.
 */
export function loopbackSignInAddress(authorizationUrl: string, apiBaseUrl: string, pageUrl: string): string | null {
  try {
    const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri")
    if (!redirectUri) return null
    const page = new URL(pageUrl)
    const started = new URL(apiBaseUrl, page).hostname
    const returning = new URL(redirectUri).hostname
    if (started === returning || !LOOPBACK_HOSTS.has(started) || !LOOPBACK_HOSTS.has(returning)) return null
    page.hostname = returning
    page.search = ""
    page.hash = ""
    return page.toString()
  } catch {
    return null
  }
}

/** The only URLs the SPA will hand to `assignLocation` from the OAuth start response. */
export function isNavigableProviderUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const { protocol } = new URL(value)
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}
