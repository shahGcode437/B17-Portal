import { AnimatePresence, motion } from "motion/react"
import { SearchX } from "lucide-react"
import type { SearchHit, SearchResult } from "@/types/search"
import { Grid } from "@/components/foundation/Grid"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { TutorCard } from "@/components/cards/TutorCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { NewsCard } from "@/components/cards/NewsCard"
import { ResultCardSkeleton } from "@/components/feedback/ResultCardSkeleton"
import { EmptyState } from "@/components/feedback/EmptyState"
import {
  mapProviderToResult,
  mapBusinessToResult,
  mapTutorToResult,
  mapPropertyToResult,
  mapNewsToResult,
} from "@/services/mappers"
import { duration } from "@/lib/motion"

interface ResultListProps {
  hits: SearchHit[]
  loading: boolean
  onSelect: (result: SearchResult) => void
  onClearFilters: () => void
}

function renderHit(hit: SearchHit, onSelect: (result: SearchResult) => void) {
  switch (hit.kind) {
    case "provider":
      return <ProviderCard provider={hit.item} onSelect={() => onSelect(mapProviderToResult(hit.item))} />
    case "business":
      return <BusinessCard business={hit.item} onSelect={() => onSelect(mapBusinessToResult(hit.item))} />
    case "tutor":
      return <TutorCard tutor={hit.item} onSelect={() => onSelect(mapTutorToResult(hit.item))} />
    case "property":
      return <PropertyCard property={hit.item} onSelect={() => onSelect(mapPropertyToResult(hit.item))} />
    case "news":
      return <NewsCard article={hit.item} onSelect={() => onSelect(mapNewsToResult(hit.item))} />
  }
}

/** Search/Explore result grid: skeleton → empty state → mixed-kind result cards. */
function ResultList({ hits, loading, onSelect, onClearFilters }: ResultListProps) {
  const stateKey = loading ? "loading" : hits.length === 0 ? "empty" : "results"

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.route }}
        >
          <Grid cols={3} gap={4}>
            {Array.from({ length: 6 }).map((_, i) => (
              <ResultCardSkeleton key={i} />
            ))}
          </Grid>
        </motion.div>
      ) : hits.length === 0 ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.route }}
        >
          <EmptyState
            icon={SearchX}
            title="No results found"
            description="Try a different search term, or clear filters to browse everything."
            actionLabel="Clear filters"
            onAction={onClearFilters}
          />
        </motion.div>
      ) : (
        <motion.div
          key={`results-${stateKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.route }}
        >
          <Grid cols={3} gap={4}>
            {hits.map((hit) => (
              <div key={`${hit.kind}-${hit.item.id}`}>{renderHit(hit, onSelect)}</div>
            ))}
          </Grid>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export { ResultList }
