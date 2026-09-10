import * as React from "react"
import { cn } from "@/lib/utils"

interface DividerProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical"
}

/** Restrained hairline separator — never a decorative rule. */
function Divider({ orientation = "horizontal", className, ...props }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="divider"
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      {...props}
    />
  )
}

export { Divider }
