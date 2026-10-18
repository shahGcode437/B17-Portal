/**
 * One-time tokens delivered in a URL FRAGMENT (docs/backend/AUTH_RBAC.md §8, §22.4): e-mail links
 * look like `/verify-email#token=…` and `/reset-password#token=…`. The fragment never reaches a
 * server or a `Referer`, but it must not linger in the address bar or history either, so:
 *
 *  1. the token is read from `location.hash`;
 *  2. the fragment is IMMEDIATELY removed with `history.replaceState` (keeping the router's own
 *     history state, so React Router is not disturbed);
 *  3. the token is held in module memory only — never in localStorage, sessionStorage, a cookie,
 *     another URL, or a log — until the page has used it (`clearFragmentToken`).
 *
 * `captureFragmentToken()` runs at module-evaluation time through `fragmentBootstrap.ts` (the first
 * import of `main.tsx`, so before the router is created) and again from the pages; it is
 * idempotent, which also makes React StrictMode's double render/effect harmless.
 */

export const TOKEN_ROUTES: readonly string[] = ["/verify-email", "/reset-password"]

let captured: { path: string; token: string } | null = null

/** Moves a `#token=` fragment on a token route into memory and strips it from the URL. */
export function captureFragmentToken(): void {
  const { pathname, search, hash } = window.location
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname // the router also matches "/verify-email/"
  if (!TOKEN_ROUTES.includes(path) || hash.length <= 1) return
  const token = new URLSearchParams(hash.slice(1)).get("token")
  window.history.replaceState(window.history.state, "", `${pathname}${search}`)
  if (token) captured = { path, token }
}

/** The token captured for `path`, if any (it stays available until `clearFragmentToken`). */
export function takeFragmentToken(path: string): string | null {
  captureFragmentToken()
  return captured && captured.path === path ? captured.token : null
}

export function clearFragmentToken(): void {
  captured = null
}
