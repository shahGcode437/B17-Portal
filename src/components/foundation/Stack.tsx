import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const stackVariants = cva("flex", {
  variants: {
    direction: {
      row: "flex-row",
      column: "flex-col",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    wrap: {
      true: "flex-wrap",
      false: "flex-nowrap",
    },
    gap: {
      0: "gap-0",
      1: "gap-1",
      2: "gap-2",
      3: "gap-3",
      4: "gap-4",
      6: "gap-6",
      8: "gap-8",
      12: "gap-12",
      16: "gap-16",
    },
  },
  defaultVariants: {
    direction: "column",
    align: "stretch",
    justify: "start",
    wrap: false,
    gap: 4,
  },
})

interface StackProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof stackVariants> {
  as?: React.ElementType
}

/** Flex layout primitive — the default building block for spacing children. */
function Stack({
  as: Comp = "div",
  direction,
  align,
  justify,
  wrap,
  gap,
  className,
  ...props
}: StackProps) {
  return (
    <Comp
      data-slot="stack"
      className={cn(stackVariants({ direction, align, justify, wrap, gap }), className)}
      {...props}
    />
  )
}

export { Stack, stackVariants }
