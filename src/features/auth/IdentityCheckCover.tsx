import { useLayoutEffect, useRef, type SyntheticEvent } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"

/** `checking`: waiting for the server. `unconfirmed`: it could not be asked. */
export type IdentityCheck = "checking" | "unconfirmed"

const MARK = "data-identity-check"
const OWN = "data-identity-cover"

/** Keeps a press on the cover from counting as a press outside an open dialog (which would close it). */
const keepHere = (event: SyntheticEvent) => event.stopPropagation()

/**
 * Covers the whole page while it isn't known who is signed in (SECURITY). Everything beneath stays
 * mounted, so the same account gets its screen back exactly as it was, but it can't be seen, reached
 * with the keyboard or read by a screen reader: dialogs and messages included, since they are drawn
 * beside the app in `body`. (`index.css` hides whatever appears while the mark is set.)
 */
function Cover({ state, onRetry }: { state: IdentityCheck; onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const added = Array.from(document.body.children).filter(
      (element) => element !== ref.current && !element.hasAttribute("inert")
    )
    added.forEach((element) => element.setAttribute("inert", ""))
    // An open dialog listens for Escape on the document, ahead of anything here, and would close and
    // lose its form. `window` hears the key first.
    const holdEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", holdEscape, true)
    ref.current?.focus()
    return () => {
      window.removeEventListener("keydown", holdEscape, true)
      added.forEach((element) => element.removeAttribute("inert"))
      document.documentElement.removeAttribute(MARK)
      // Only the same account's screen is still there to go back to.
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  // With what is on screen, not after it: the mark is what hides everything else.
  useLayoutEffect(() => {
    document.documentElement.setAttribute(MARK, state)
  }, [state])

  return createPortal(
    <div
      ref={ref}
      {...{ [OWN]: "" }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="identity-check-title"
      aria-describedby="identity-check-detail"
      tabIndex={-1}
      onPointerDown={keepHere}
      onKeyDown={keepHere}
      className="pointer-events-auto fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background p-6 text-center outline-none"
    >
      <p id="identity-check-title" className="font-heading text-lg font-semibold text-foreground">
        {state === "checking" ? "Checking who is signed in…" : "We couldn't check who is signed in"}
      </p>
      <p id="identity-check-detail" className="max-w-sm text-sm text-muted-foreground">
        {state === "checking"
          ? "This browser's sign-in may have changed. Your page will be back in a moment."
          : "This browser's sign-in may have changed, so this page stays covered until we can check. Check your connection."}
      </p>
      {state === "unconfirmed" && (
        <Button type="button" className="h-11" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>,
    document.body
  )
}

function IdentityCheckCover({ state, onRetry }: { state: IdentityCheck | null; onRetry: () => void }) {
  return state === null ? null : <Cover state={state} onRetry={onRetry} />
}

export { IdentityCheckCover }
