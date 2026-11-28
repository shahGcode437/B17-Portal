/**
 * Telling the other tabs of this browser that the sign-in changed (SECURITY, `docs/backend/AUTH_RBAC.md`
 * §23.2). They share one cookie, so a sign-in or sign-out in one changes who all of them are.
 *
 * The message is a bare signal. It names no account and carries no token or private detail, and a
 * receiver never reads it: whatever arrives only means "ask the server who you are now". It is not
 * authority, so a forged or repeated one costs one `/auth/me` and nothing else.
 *
 * Where `BroadcastChannel` is missing there is no signal, and nothing is written to web storage to
 * imitate one: those tabs ask again whenever the person returns to them.
 */
const CHANNEL_NAME = "b17-auth"
const MESSAGE = { type: "b17:auth-changed" } as const

export interface AuthChannel {
  /** `false` when this browser can't carry the signal. */
  supported: boolean
  announce: () => void
  close: () => void
}

export function createAuthChannel(onAnnounced: () => void): AuthChannel {
  if (typeof BroadcastChannel !== "function") return { supported: false, announce: () => {}, close: () => {} }
  const channel = new BroadcastChannel(CHANNEL_NAME)
  let open = true
  channel.onmessage = () => onAnnounced()
  return {
    supported: true,
    // A channel never hears its own posts, and nothing posts in reply to one: no loops.
    announce: () => {
      if (open) channel.postMessage(MESSAGE)
    },
    close: () => {
      open = false
      channel.close()
    },
  }
}
