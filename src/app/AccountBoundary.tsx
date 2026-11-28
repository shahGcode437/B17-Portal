import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@/hooks/useAuth"
import { ToastContext, useToast, type ToastContextValue } from "@/hooks/useToast"

export const ACCOUNT_CHANGED_MESSAGE = "You're now signed in as a different account, so this page was reset."
export const SESSION_ENDED_MESSAGE = "Your session ended, so this page was reset. Log in again to continue."

interface Seen {
  /** The account the tree below was last built for; `null` while nobody is signed in. */
  userId: string | null
  /** A new number builds the tree below again, from nothing. */
  epoch: number
  /** What to tell the person about the rebuild of that epoch (once). */
  say: { epoch: number; message: string } | null
}

/**
 * Nothing one account was doing stays on screen for the next (SECURITY). When the signed-in account
 * stops being the signed-in account (another one took its place, or the session ended), every
 * layout, page, form, dialog and held click below is thrown away and built again, so none of it can
 * be read, or sent, under the new session.
 *
 *  - `loading` and `unavailable` say nothing about who is there: nothing changes.
 *  - A visitor who signs in keeps their screen (what they typed beforehand is theirs).
 *  - The same account with a renewed session or CSRF token keeps its screen.
 *  - Messages: a screen that has been thrown away can no longer show one, whatever it was waiting
 *    for finishes later, and the ones already showing are cleared.
 *
 * What lives outside the tree (the grocery draft, the saved set) clears itself.
 */
function AccountBoundary({ children }: { children: ReactNode }) {
  const { status, user, notice } = useAuth()
  const { show, clear } = useToast()
  const [seen, setSeen] = useState<Seen>({ userId: null, epoch: 0, say: null })
  const decided = status === "authenticated" || status === "anonymous"
  const userId = user?.id ?? null

  // Adjusted during render, so the tree below is never rendered for the new account under the old key.
  if (decided && userId !== seen.userId) {
    const left = seen.userId !== null
    const epoch = left ? seen.epoch + 1 : seen.epoch
    const message = userId !== null ? ACCOUNT_CHANGED_MESSAGE : notice !== null ? SESSION_ENDED_MESSAGE : null
    setSeen({ userId, epoch, say: left && message ? { epoch, message } : seen.say })
  }

  const { epoch, say } = seen
  const live = useRef(epoch)
  useLayoutEffect(() => {
    live.current = epoch
  }, [epoch])

  // The tree's own way to show a message: it stops working when its tree is replaced.
  const scoped = useMemo<ToastContextValue>(
    () => ({
      show: (message, options) => {
        if (epoch >= live.current) show(message, options)
      },
      clear,
    }),
    [epoch, show, clear]
  )

  const cleared = useRef(0)
  useEffect(() => {
    if (cleared.current === epoch) return
    cleared.current = epoch
    clear?.()
    if (say?.epoch === epoch) show(say.message, { tone: "error" })
  }, [epoch, say, show, clear])

  return (
    <ToastContext.Provider value={scoped}>
      <Fragment key={epoch}>{children}</Fragment>
    </ToastContext.Provider>
  )
}

export { AccountBoundary }
