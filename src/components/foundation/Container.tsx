import * as React from "react"
import { cn } from "@/lib/utils"

interface ContainerProps extends React.ComponentProps<"div"> {
  /** Render as a different element, e.g. "section" or "main". */
  as?: React.ElementType
}

/**
 * Centered, max-width-constrained content wrapper with responsive gutters.
 * Use for every top-level page/section so large-desktop content stays readable.
 */
function Container({ as: Comp = "div", className, ...props }: ContainerProps) {
  return (
    <Comp
      data-slot="container"
      className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}
      {...props}
    />
  )
}

export { Container }
