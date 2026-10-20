import type { ReactNode } from "react"
import { motion } from "motion/react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { SectionHeader } from "@/components/foundation/SectionHeader"
import { ReadBoundary } from "@/components/feedback/ReadBoundary"
import { ResultCardSkeleton } from "@/components/feedback/ResultCardSkeleton"
import type { ReadResult } from "@/hooks/useRead"
import { cn } from "@/lib/utils"
import { staggerContainer, staggerItem } from "@/lib/motion"

interface PreviewSectionProps<T> {
  title: string
  description: string
  viewAllPath: string
  read: ReadResult<{ items: T[] }>
  cols: 3 | 4
  /** How many cards to show (the read may have fetched a few more, e.g. to put featured items first). */
  limit: number
  /** Re-orders what was fetched before the first `limit` are taken (featured-first, for example). */
  order?: (items: T[]) => T[]
  /** A soft background band, as the section had before. */
  tinted?: boolean
  getKey: (item: T) => string
  renderCard: (item: T) => ReactNode
}

/**
 * A Home discovery section backed by a real read (Phase 12G). While the request is in flight it shows
 * card-shaped skeletons (so nothing jumps); if it FAILED it says so, with a retry; if the server has
 * nothing to show the whole section is simply omitted (there is no demo filler). The section never
 * ranks anything itself - `order` is the caller's choice and only re-orders what the server returned.
 */
function PreviewSection<T>({
  title,
  description,
  viewAllPath,
  read,
  cols,
  limit,
  order,
  tinted,
  getKey,
  renderCard,
}: PreviewSectionProps<T>) {
  if (read.status === "success" && read.data.items.length === 0) return null

  const body = (
    <Container className="py-12 sm:py-16">
      <SectionHeader title={title} description={description} viewAllPath={viewAllPath} />
      <ReadBoundary
        read={read}
        errorTitle={`Couldn't load ${title.toLowerCase()}`}
        loading={
          <div role="status" aria-label={`Loading ${title}`}>
            <Grid cols={cols} gap={4}>
              {Array.from({ length: cols }).map((_, index) => (
                <ResultCardSkeleton key={index} />
              ))}
            </Grid>
          </div>
        }
      >
        {(page) => (
          <motion.div initial="initial" animate="animate" variants={staggerContainer}>
            <Grid cols={cols} gap={4}>
              {(order ? order(page.items) : page.items).slice(0, limit).map((item) => (
                <motion.div key={getKey(item)} variants={staggerItem}>
                  {renderCard(item)}
                </motion.div>
              ))}
            </Grid>
          </motion.div>
        )}
      </ReadBoundary>
    </Container>
  )
  return tinted ? <section className={cn("bg-secondary/30")}>{body}</section> : body
}

export { PreviewSection }
