import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "motion/react"
import { cn } from "cn"
import { cardHover } from "@/lib/motion"

const cardVariants = cva(
  "flex flex-col gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
  {
    variants: {
      variant: {
        default: "border-border shadow-subtle",
        interactive:
          "cursor-pointer border-border shadow-subtle hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        elevated: "border-border shadow-medium",
        workspace: "gap-3 border-border p-4 shadow-subtle",
        featured:
          "cursor-pointer border-brand-accent/40 shadow-subtle hover:border-brand-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Variants whose surface is meant to be clicked — these get the shared hover/press lift. */
const HOVER_LIFT_VARIANTS = new Set(["interactive", "featured"])

interface CardProps extends React.ComponentProps<typeof motion.div>, VariantProps<typeof cardVariants> {}

/**
 * Shared card surface (Visual V1 — DESIGN_SYSTEM.md §8). Centralizes the
 * border/radius/background/shadow/hover-lift surface that was previously
 * duplicated verbatim across ProviderCard/BusinessCard/TutorCard/PropertyCard.
 *
 * Presentation only: Card never sets `role`/`tabIndex`/`onClick`/`onKeyDown`/
 * `aria-label` itself, so it never turns a static surface into a fake button.
 * A consumer that wants a clickable card (`variant="interactive"` or
 * `"featured"`) must still supply those explicitly, exactly as the migrated
 * domain cards do today.
 */
function Card({ className, variant = "default", ...props }: CardProps) {
  const hoverProps = variant && HOVER_LIFT_VARIANTS.has(variant) ? cardHover : undefined

  return (
    <motion.div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant }), className)}
      {...hoverProps}
      {...props}
    />
  )
}

export { Card }
