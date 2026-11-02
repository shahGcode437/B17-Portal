import type { LucideIcon } from "lucide-react"
import { motion } from "motion/react"
import { Link } from "react-router-dom"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { cardHover } from "@/lib/motion"
import { cn } from "@/lib/utils"

const MotionLink = motion.create(Link)

interface CategoryCardProps {
  to: string
  icon: LucideIcon
  label: string
  description?: string
  emphasis?: boolean
  compact?: boolean
  className?: string
}

/** Clickable category tile — used for Quick Discovery and service categories. */
function CategoryCard({ to, icon: Icon, label, description, emphasis, compact, className }: CategoryCardProps) {
  return (
    <MotionLink
      to={to}
      {...cardHover}
      className={cn(
        // VR2: category tiles are Level-2 glass; emphasis (core modules) get a primary ring + glow so they
        // read as more prominent than secondary ones. Glass CSS stays in the shared utility, not per-tile.
        "relative flex flex-col items-center gap-2 overflow-hidden rounded-xl text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring glass-2",
        compact ? "p-3" : "p-5",
        emphasis && "ring-1 ring-inset ring-primary/40",
        className
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-lg",
          compact ? "size-9" : "size-11",
          emphasis ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
        )}
      >
        <Icon className={compact ? "size-4.5" : "size-5"} aria-hidden="true" />
      </span>
      <Stack gap={1}>
        <Typography variant={compact ? "body-sm" : "label"} className="font-medium">
          {label}
        </Typography>
        {description && !compact && (
          <Typography variant="caption" className="text-balance">
            {description}
          </Typography>
        )}
      </Stack>
    </MotionLink>
  )
}

export { CategoryCard }
