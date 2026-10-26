import type { NavigationType } from "react-router-dom"

/** Where a navigation landed (the parts of a router location that decide scrolling). */
export interface Landing {
  key: string
  pathname: string
  search: string
  hash: string
}

/** What a navigation should do to the scroll position. */
export type ScrollIntent =
  /** Leave it alone (Back / Forward, an in-place edit such as a search filter, the first render). */
  | "keep"
  /** Jump to the top: a new page. */
  | "top"
  /** Glide to the top: the SAME URL was activated again (a logo / nav link to the page you are on). */
  | "top-smooth"
  /** Bring the element named by the URL fragment into view. */
  | "hash"

/**
 * The one scroll rule for the whole app (Phase 12S, S3). Pure, so it is tested without a browser.
 *
 *  - Back / Forward (`POP`) and the very first render: the browser's own history scroll handling stays in charge.
 *  - A fragment that names an element on the page: scroll to that element (`hash`).
 *  - A different pathname: a new page, so it starts at the top. Without this the document is simply replaced
 *    and the browser keeps the old offset (clamped to the new height), which is how a footer link used to open
 *    the destination page scrolled to its bottom.
 *  - The same pathname, a new history entry (`PUSH`): still a new page (e.g. a link to another `/search?...`).
 *  - The same pathname, `REPLACE`, different query: an in-place edit (Search writes its filters this way), so
 *    the reader keeps their place.
 *  - The very same URL again (React Router turns that into a `REPLACE`): the reader asked for this page while
 *    already on it, typically through the logo. Glide to the top so the click visibly does something.
 */
export function scrollIntentFor(
  previous: Landing | null,
  next: Landing,
  type: `${NavigationType}`,
  hashTargetExists: boolean
): ScrollIntent {
  if (previous === null || previous.key === next.key) return "keep" // first render, or a Strict Mode re-run
  if (type === "POP") return "keep"
  if (next.hash && hashTargetExists) return "hash"
  if (previous.pathname !== next.pathname) return "top"
  if (previous.search === next.search && previous.hash === next.hash) return "top-smooth"
  return type === "PUSH" ? "top" : "keep"
}
