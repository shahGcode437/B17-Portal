import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "motion/react"
import { cn } from "cn"
import { cardHover } from "@/lib/motion"

// VR1: every surface composes a glass utility from index.css (one source of truth, never
// per-page glass CSS). Display surfaces are translucent Level-2 glass; content-heavy surfaces
// (workspace / panel) use the more opaque `glass-panel` so dense text and forms stay readable.
const cardVariants = cva("flex flex-col gap-3 rounded-xl p-3 text-left transition-[box-shadow,transform,border-color,background-color]", {
  variants: {
    variant: {
      default: "glass-2",
      interactive: "glass-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      elevated: "glass-2 shadow-elevated",
      workspace: "glass-panel gap-3 p-4",
      featured:
        "glass-2 cursor-pointer ring-1 ring-inset ring-brand-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      /** Explicit Level-2 glass surface (same as default; named for intent). */
      glass: "glass-2",
      /** Content-heavy readable panel (dashboards, information regions). */
      panel: "glass-panel",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

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
