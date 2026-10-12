/**
 * "Skip to main content" (Phase 9J): the first focusable element in every layout, visible only while
 * focused. It moves focus to the layout's <main id="main-content"> without changing the URL (a plain
 * #hash link would add a history entry and a fragment to the address).
 */
function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(event) => {
        event.preventDefault()
        const main = document.getElementById("main-content")
        main?.focus()
        main?.scrollIntoView()
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:rounded-lg focus:bg-background focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-elevated focus-visible:ring-2 focus-visible:ring-ring"
    >
      Skip to main content
    </a>
  )
}

export { SkipLink }
