/**
 * The ONE thing about a grocery submission that outlives a page reload (GROCERY-4B): that an order
 * was being sent and no answer had arrived. It says WHOSE (the account id) and WHEN, nothing else:
 * no item, name, phone number, address, idempotency key or token. The order being written stays in
 * memory only (`groceryDraftStore`), so after a reload nothing can be resent by itself; this only
 * lets the next screen say "check before you send another".
 *
 * `sessionStorage`: this tab only, gone when it closes. Removed when the outcome is known, when the
 * customer says they have checked, on signing out, when another account is seen, and after a day.
 * Storage that is missing or refuses (private browsing) simply means no reminder.
 */
export const MARKER_KEY = "b17:grocery-unconfirmed"
export const MARKER_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface SubmissionMarker {
  owner: string
  /** When the FIRST send of the attempt left this browser (its clock, ms). */
  sentAt: number
}

export function clearMarker(): void {
  try {
    window.sessionStorage.removeItem(MARKER_KEY)
  } catch {
    // nothing to remove from storage that can't be used
  }
}

export function writeMarker(marker: SubmissionMarker): void {
  try {
    window.sessionStorage.setItem(MARKER_KEY, JSON.stringify({ owner: marker.owner, sentAt: marker.sentAt }))
  } catch {
    // no reminder after a reload; the send itself is unaffected
  }
}

/** The marker, if it is well formed and less than a day old. Anything else is removed. */
export function readMarker(now: number = Date.now()): SubmissionMarker | null {
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(MARKER_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<SubmissionMarker>
    if (typeof value.owner === "string" && value.owner && typeof value.sentAt === "number") {
      if (now - value.sentAt < MARKER_LIFETIME_MS) return { owner: value.owner, sentAt: value.sentAt }
    }
  } catch {
    // not ours, or damaged
  }
  clearMarker()
  return null
}
