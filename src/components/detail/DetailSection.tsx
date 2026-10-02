import { useId } from "react"
import type { ReactNode } from "react"
import { Typography } from "@/components/foundation/Typography"

interface DetailSectionProps {
  title: string
  children: ReactNode
}

/** A titled block of supporting information (h2 under the page's h1), labelled for assistive tech. */
function DetailSection({ title, children }: DetailSectionProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Typography as="h2" id={headingId} variant="h3" className="text-lg sm:text-xl">
        {title}
      </Typography>
      {children}
    </section>
  )
}

export { DetailSection }
