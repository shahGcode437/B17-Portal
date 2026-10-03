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
        "flex flex-col items-center gap-2 rounded-xl border bg-card text-center shadow-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "p-3" : "p-5",
        emphasis ? "border-primary/30 bg-primary/5" : "border-border hover:border-primary/30",
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
