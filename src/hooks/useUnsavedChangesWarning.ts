import { useEffect } from "react"
import { useBlocker } from "react-router-dom"

/**
 * While `dirty`: leaving for another page in the app is held (the caller shows a dialog and calls
 * `proceed` or `reset`), and closing or reloading the tab asks the browser's own question. When the
 * access gate takes the page away (sign-out, lost access, another account) the page unmounts first,
 * so nothing is held and the edits are gone with it.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname
  )

  useEffect(() => {
    if (!dirty) return
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", ask)
    return () => window.removeEventListener("beforeunload", ask)
  }, [dirty])

  return blocker
}
