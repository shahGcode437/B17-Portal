import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const gridVariants = cva("grid", {
  variants: {
    /** Columns at the mobile/tablet/desktop breakpoints (spec: 1/2/3-4 col cards). */
    cols: {
      1: "grid-cols-1",
      2: "grid-cols-1 sm:grid-cols-2",
      3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
      12: "grid-cols-12",
    },
    gap: {
      2: "gap-2",
      4: "gap-4",
      6: "gap-6",
      8: "gap-8",
    },
  },
  defaultVariants: {
    cols: 3,
    gap: 6,
  },
})

interface GridProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof gridVariants> {
  as?: React.ElementType
}

/** Responsive CSS grid primitive for card/result layouts. */
function Grid({ as: Comp = "div", cols, gap, className, ...props }: GridProps) {
  return (
    <Comp
      data-slot="grid"
      className={cn(gridVariants({ cols, gap }), className)}
      {...props}
    />
  )
}

export { Grid, gridVariants }
