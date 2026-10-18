/**
 * Full-page navigation, behind a function so tests can stub it (jsdom cannot navigate). Used only
 * for the backend-issued Google `authorizationUrl`, which the SPA never stores, shows or logs.
 */
export function assignLocation(url: string): void {
  window.location.assign(url)
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
