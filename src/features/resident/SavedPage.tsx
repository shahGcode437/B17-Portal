import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Heart } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ReadError } from "@/components/feedback/ReadError"
import { ResultCardSkeleton } from "@/components/feedback/ResultCardSkeleton"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { TutorCard } from "@/components/cards/TutorCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { SAVED_KIND_META } from "@/features/resident/savedItems"
import { useSaved } from "@/hooks/useResidentReads"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import {
  providerProfilePath,
  businessProfilePath,
  tutorProfilePath,
  propertyDetailsPath,
  routes,
} from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { SavedEntry } from "@/lib/api/privateAdapters"
import type { SavedItemKind } from "@/types/resident"

function renderCard(entry: SavedEntry, navigate: ReturnType<typeof useNavigate>) {
  const { hit } = entry
  switch (hit.kind) {
    case "provider":
      return <ProviderCard provider={hit.item} onSelect={() => navigate(providerProfilePath(hit.item.id))} />
    case "business":
      return <BusinessCard business={hit.item} onSelect={() => navigate(businessProfilePath(hit.item.id))} />
    case "tutor":
      return <TutorCard tutor={hit.item} onSelect={() => navigate(tutorProfilePath(hit.item.id))} />
    case "property":
      return <PropertyCard property={hit.item} onSelect={() => navigate(propertyDetailsPath(hit.item.id))} />
  }
}

const KIND_ORDER: SavedItemKind[] = ["provider", "business", "tutor", "property"]

/**
 * The resident's saved listings (Phase 9C; collection layout in Visual V4), read from `GET /saved`
 * (Phase 12G). The server returns only listings that are still approved - a saved item that was taken
 * down is simply absent, and returns if it is approved again - as the same public cards the rest of
 * the site uses. Saving and removing are NOT available yet (Phase 12H), so this page is read-only and
 * says so; the browser-local list the old version kept is no longer consulted.
 */
function SavedPage() {
  const user = useRequireAuth()
  const navigate = useNavigate()
  const saved = useSaved()

  if (!user) return null

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    entries: saved.items.filter((entry) => entry.hit.kind === kind),
  })).filter((group) => group.entries.length > 0)

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-5xl">
        <Stack gap={6}>
          <Stack gap={1}>
            <Typography variant="h1" className="text-2xl sm:text-3xl">
              Saved
            </Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {saved.loading || saved.error
                ? "Things you save show up here."
                : saved.total === 0
                  ? "Things you save show up here."
                  : `${saved.total} saved ${saved.total === 1 ? "item" : "items"}. Saving and removing items is coming soon.`}
            </Typography>
          </Stack>
          <ResidentNav />

          {saved.loading ? (
            <div role="status" aria-label="Loading saved items">
              <Grid cols={3} gap={4}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <ResultCardSkeleton key={index} />
                ))}
              </Grid>
            </div>
          ) : saved.error ? (
            <ReadError error={saved.error} onRetry={saved.retry} title="Couldn't load your saved items" />
          ) : saved.items.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="Nothing saved yet"
              description="Saving services, businesses, tutors and properties is coming soon. They'll show up here."
              actionLabel="Explore B-17"
              onAction={() => navigate(routes.search)}
            />
          ) : (
            <Stack gap={8}>
              {groups.map(({ kind, entries }) => (
                <WorkspaceSection key={kind} title={`${SAVED_KIND_META[kind].plural} (${entries.length})`}>
                  <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                    <Grid cols={3} gap={4}>
                      {entries.map((entry) => (
                        <motion.div key={`${entry.hit.kind}-${entry.hit.item.id}`} variants={staggerItem}>
                          {renderCard(entry, navigate)}
                        </motion.div>
                      ))}
                    </Grid>
                  </motion.div>
                </WorkspaceSection>
              ))}
              {saved.hasMore && (
                <Stack align="center" gap={2}>
                  <Button variant="outline" onClick={saved.loadMore} disabled={saved.loadingMore}>
                    {saved.loadingMore ? "Loading…" : "Load More"}
                  </Button>
                  {saved.moreError && (
                    <Typography variant="body-sm" role="alert" className="text-destructive">
                      Couldn't load more. Try again.
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { SavedPage }
