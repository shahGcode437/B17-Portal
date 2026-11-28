import { Fragment, useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"

export const ACCOUNT_CHANGED_MESSAGE = "You're now signed in as a different account, so this page was reset."

interface Seen {
  /** The account the tree below was last built for; `null` while nobody is signed in. */
  userId: string | null
  /** A new number builds the tree below again, from nothing. */
  epoch: number
  /** The epoch in which one account directly took another's place (said once, on screen). */
  switched: number | null
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
 *
 * What lives outside the tree (the grocery draft, the saved set) clears itself.
 */
function AccountBoundary({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const toast = useToast()
  const [seen, setSeen] = useState<Seen>({ userId: null, epoch: 0, switched: null })
  const decided = status === "authenticated" || status === "anonymous"
  const userId = user?.id ?? null

  // Adjusted during render, so the tree below is never rendered for the new account under the old key.
  if (decided && userId !== seen.userId) {
    const left = seen.userId !== null
    const epoch = left ? seen.epoch + 1 : seen.epoch
    setSeen({ userId, epoch, switched: left && userId !== null ? epoch : seen.switched })
  }

  const { switched } = seen
  const { show } = toast
  useEffect(() => {
    if (switched !== null) show(ACCOUNT_CHANGED_MESSAGE, { tone: "error" })
  }, [switched, show])

  return <Fragment key={seen.epoch}>{children}</Fragment>
}

export { AccountBoundary }
