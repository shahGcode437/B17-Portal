/**
 * Builds a query string from a parameter bag. `undefined`, `null` and blank values are DROPPED
 * (never serialized as `key=`), and everything is percent-encoded by `URLSearchParams`, so a user's
 * search text can never break out of its parameter. Returns "" or a string starting with "?".
 */
export type QueryValue = string | number | boolean | null | undefined

export function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const text = String(value)
    if (text.trim() === "") continue
    search.set(key, text)
  }
  const built = search.toString()
  return built ? `?${built}` : ""
}

/** A path segment taken from data or a URL (an id): always encoded, so `../` or `?` cannot escape it. */
export function segment(value: string): string {
  return encodeURIComponent(value)
}
