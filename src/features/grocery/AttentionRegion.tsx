import { useEffect, useRef, type ReactNode } from "react"

/**
 * A message that must not be missed because it appears AWAY from where the person is (a refused or
 * unconfirmed submission is shown at the top while the Send button is at the bottom of a phone
 * screen). When it appears, or `signal` changes, it is scrolled into view and focused.
 */
function AttentionRegion({ signal, children }: { signal: unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollIntoView({ block: "start" })
    element.focus({ preventScroll: true })
  }, [signal])
  return (
    // `scroll-mt` keeps it clear of the sticky header.
    <div ref={ref} tabIndex={-1} className="scroll-mt-24 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </div>
  )
}

export { AttentionRegion }
