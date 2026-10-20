import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { motion } from "motion/react"
import { Grid } from "@/components/foundation/Grid"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadBoundary } from "@/components/feedback/ReadBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReadResult } from "@/hooks/useRead"
import type { CategoryDto } from "@/lib/api/dto/public"
import { staggerContainer, staggerItem } from "@/lib/motion"

interface CategoryTilesProps {
  read: ReadResult<CategoryDto[]>
  iconFor: (slug: string) => LucideIcon
  hrefFor: (category: CategoryDto) => string
  cols?: 4 | 5
  compact?: boolean
  /** Tiles that come before the server's categories (e.g. the Food & Dining entry on the Directory). */
  leading?: ReactNode
  /** Names the thing for the empty / error copy, e.g. "service categories". */
  noun: string
}

/**
 * A grid of category tiles built from `GET /categories` (Phase 12G): skeleton tiles while loading,
 * a retryable error if the request failed, an honest empty state if there are none. The categories,
 * their names and their order are the server's; only the icon is decoration (`config/categoryIcons`).
 */
function CategoryTiles({ read, iconFor, hrefFor, cols = 4, compact, leading, noun }: CategoryTilesProps) {
  return (
    <ReadBoundary
      read={read}
      errorTitle={`Couldn't load ${noun}`}
      loading={
        <div role="status" aria-label={`Loading ${noun}`}>
          <Grid cols={cols} gap={compact ? 3 : 4}>
            {Array.from({ length: cols * 2 }).map((_, index) => (
              <Skeleton key={index} className={compact ? "h-20 rounded-xl" : "h-28 rounded-xl"} aria-hidden="true" />
            ))}
          </Grid>
        </div>
      }
      isEmpty={(categories) => categories.length === 0 && !leading}
      empty={<EmptyState title={`No ${noun} yet`} description="Check back soon." />}
    >
      {(categories) => (
        <motion.div initial="initial" animate="animate" variants={staggerContainer}>
          <Grid cols={cols} gap={compact ? 3 : 4}>
            {leading}
            {categories.map((category) => (
              <motion.div key={category.id} variants={staggerItem}>
                <CategoryCard
                  to={hrefFor(category)}
                  icon={iconFor(category.slug)}
                  label={category.name}
                  compact={compact}
                />
              </motion.div>
            ))}
          </Grid>
        </motion.div>
      )}
    </ReadBoundary>
  )
}

export { CategoryTiles }
