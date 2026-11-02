import { useId } from "react"
import type { ReactNode } from "react"
import { Typography } from "@/components/foundation/Typography"

interface DetailSectionProps {
  title: string
  children: ReactNode
}

/**
 * A titled block of supporting information (h2 under the page's h1), labelled for assistive tech. It is a
 * content-heavy region, so it uses the more opaque `glass-panel` surface: long descriptions, fact lists and menus
 * stay readable (accessibility beats transparency).
 */
function DetailSection({ title, children }: DetailSectionProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="glass-panel flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
      <Typography as="h2" id={headingId} variant="h3" className="text-lg sm:text-xl">
        {title}
      </Typography>
      {children}
    </section>
  )
}

export { DetailSection }
