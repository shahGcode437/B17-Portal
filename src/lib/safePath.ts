/**
 * Open-redirect safety for the SPA (Phase 12C). Any post-login destination — react-router
 * `location.state.from`, a query parameter, anything — is validated here before it is navigated to.
 * Only a LOCAL, rooted path is ever accepted: never an absolute URL, a scheme-relative `//host`, a
 * backslash trick, an encoded variant, a control character, or an API path.
 *
 * (The Google `authorizationUrl` returned by the backend is a different, special case: it is
 * consumed only from the typed start call and never goes through this function.)
 */

const SAFE_CHARS = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/

/** Returns `value` when it is a safe local path (query / fragment allowed), else `null`. */
export function safeLocalPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return null
  if (!SAFE_CHARS.test(value) || value.startsWith("//")) return null
  let decoded = value
  try {
    decoded = decodeURIComponent(decodeURIComponent(value)) // twice: catches double-encoding
  } catch {
    return null
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(decoded) ||
    decoded.split("?")[0].split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return null
  }
  const pathOnly = decoded.split(/[?#]/)[0].toLowerCase()
  if (pathOnly === "/api" || pathOnly.startsWith("/api/")) return null
  return value
}

/** The path part only (no query or fragment) when the backend's `returnTo` rules accept it, else `undefined`. */
export function backendReturnTo(value: unknown): string | undefined {
  const safe = safeLocalPath(value)
  if (!safe) return undefined
  const pathname = safe.split(/[?#]/)[0]
  if (pathname === "/" || pathname === "/login" || pathname === "/register") return undefined
  return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(pathname) && pathname.length <= 200 ? pathname : undefined
}
