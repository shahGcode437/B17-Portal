import { NETWORK_ERROR_CODE, ApiError, sessionChangedError } from "@/lib/api/errors"
import { getSessionHandlers, isStillBound, type SessionBinding, type SessionHandlers, type SessionObservation } from "@/lib/api/session"

/**
 * Whose answer was that? (SECURITY, `docs/backend/AUTH_RBAC.md` §23.2.)
 *
 * The cookie is shared by every tab and can change between any check and the request after it, so
 * asking BEFORE a private read proves nothing. This asks AFTER the answer has arrived: if the
 * browser's session is still the one the tab held when it sent the read, the cookie was that session
 * at both ends, because every sign-in makes a new session and an old one does not come back by
 * signing in again.
 *
 * What it cannot rule out: a late response that RE-SETS the old cookie (the server re-issues the
 * cookie when it slides a session) after somebody else's sign-in. Only the server can close that,
 * by refusing a read whose session is not the one the tab names (§38, proposed, not built).
 */

let owner: SessionHandlers | null = null
let running: Promise<SessionObservation> | null = null
let queued: Promise<SessionObservation> | null = null

/**
 * An observation whose request leaves after this call. Answers that arrive together share it: at
 * most one such request is on its way and one more is waiting to follow it.
 */
function observeFromNow(handlers: SessionHandlers): Promise<SessionObservation> {
  if (owner !== handlers) {
    owner = handlers
    running = queued = null
  }
  const send = (): Promise<SessionObservation> => {
    const request: Promise<SessionObservation> = handlers.observeSession().finally(() => {
      if (running === request) running = null
    })
    running = request
    return request
  }
  if (!running) return send()
  queued ??= running.then(() => {
    queued = null
    return send()
  })
  return queued
}

/**
 * Resolves only if the private answer that has just arrived, sent as `sentAs`, may be handed over.
 * With no auth layer mounted there is no session to compare with (the app always mounts one).
 */
export async function confirmPrivateAnswer(sentAs: SessionBinding, signal?: AbortSignal): Promise<void> {
  const handlers = getSessionHandlers()
  if (!handlers) return
  // The tab held no session when it asked, or has since learned of another: nothing to confirm.
  if (sentAs.token === null || !isStillBound(sentAs)) {
    if (sentAs.token === null) void observeFromNow(handlers) // somebody is signed in: find out who
    throw sessionChangedError()
  }
  const seen = await observeFromNow(handlers)
  if (signal?.aborted) throw new DOMException("The read was abandoned.", "AbortError")
  if (seen.kind === "unknown") {
    throw new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "The answer could not be confirmed." })
  }
  if (seen.kind !== "session" || seen.token !== sentAs.token || !isStillBound(sentAs)) throw sessionChangedError()
}
