import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      display: "font-heading text-4xl font-semibold tracking-tight sm:text-5xl",
      h1: "font-heading text-3xl font-semibold tracking-tight sm:text-4xl",
      h2: "font-heading text-2xl font-semibold tracking-tight sm:text-3xl",
      h3: "font-heading text-xl font-semibold tracking-tight sm:text-2xl",
      "body-lg": "font-sans text-lg leading-relaxed",
      body: "font-sans text-base leading-relaxed",
      "body-sm": "font-sans text-sm leading-relaxed",
      caption: "font-sans text-xs text-muted-foreground",
      label: "font-sans text-sm font-medium",
    },
  },
  defaultVariants: {
    variant: "body",
  },
})

/** Maps each variant to its semantically correct default element. */
const defaultElement: Record<string, React.ElementType> = {
  display: "h1",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  "body-lg": "p",
  body: "p",
  "body-sm": "p",
  caption: "span",
  label: "label",
}

interface TypographyProps
  extends React.ComponentProps<"p">,
    VariantProps<typeof typographyVariants> {
  as?: React.ElementType
}

/**
 * Centralized type scale (UI/UX Spec §5). Always compose text through this
 * component instead of ad-hoc font-size/weight utilities on raw elements.
 */
function Typography({ as, variant = "body", className, ...props }: TypographyProps) {
  const Comp = as ?? defaultElement[variant ?? "body"] ?? "p"
  return (
    <Comp
      data-slot="typography"
      className={cn(typographyVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Typography, typographyVariants }
