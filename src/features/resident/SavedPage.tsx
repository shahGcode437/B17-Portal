import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Heart } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Grid } from "@/components/foundation/Grid"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { EmptyState } from "@/components/feedback/EmptyState"
import { ProviderCard } from "@/components/cards/ProviderCard"
import { BusinessCard } from "@/components/cards/BusinessCard"
import { TutorCard } from "@/components/cards/TutorCard"
import { PropertyCard } from "@/components/cards/PropertyCard"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { SAVED_KIND_META } from "@/features/resident/savedItems"
import { useResidentStore } from "@/state/residentStore"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { getProviderById, getBusinessById, getTutorById, getPropertyById } from "@/services/search"
import {
  providerProfilePath,
  businessProfilePath,
  tutorProfilePath,
  propertyDetailsPath,
  routes,
} from "@/config/routes"
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion"
import type { SavedItem, SavedItemKind } from "@/types/resident"

/** Resolves a saved reference to its live card, or `null` if the item is no longer resolvable. */
function renderSavedItem(item: SavedItem, navigate: ReturnType<typeof useNavigate>) {
  if (item.kind === "provider") {
    const provider = getProviderById(item.id)
    if (!provider) return null
    return <ProviderCard provider={provider} onSelect={() => navigate(providerProfilePath(provider.id))} />
  }
  if (item.kind === "business") {
    const business = getBusinessById(item.id)
    if (!business) return null
    return <BusinessCard business={business} onSelect={() => navigate(businessProfilePath(business.id))} />
  }
  if (item.kind === "tutor") {
    const tutor = getTutorById(item.id)
    if (!tutor) return null
    return <TutorCard tutor={tutor} onSelect={() => navigate(tutorProfilePath(tutor.id))} />
  }
  const property = getPropertyById(item.id)
  if (!property) return null
  return <PropertyCard property={property} onSelect={() => navigate(propertyDetailsPath(property.id))} />
}

const KIND_ORDER: SavedItemKind[] = ["provider", "business", "tutor", "property"]

/**
 * Resident's saved/favorite listings (Phase 9C; collection layout in Visual
 * V4). Every card is resolved live from `search.ts` at render time —
 * `savedItems` only ever stores a `{kind, id}` reference, never a copy of the
 * domain object, so this always reflects the current state of the underlying
 * listing. Grouping by kind (newest first within each) is what identifies the
 * domain; each card keeps its own Save toggle, which is also how an item is
 * removed.
 */
function SavedPage() {
  const user = useRequireAuth()
  const savedItems = useResidentStore((state) => state.savedItems)

  const navigate = useNavigate()

  if (!user) return null

  const resolved = savedItems
    .slice()
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map((item) => ({ item, node: renderSavedItem(item, navigate) }))
    .filter((entry): entry is { item: SavedItem; node: NonNullable<typeof entry.node> } => entry.node !== null)

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    entries: resolved.filter(({ item }) => item.kind === kind),
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
              {resolved.length === 0
                ? "Things you save show up here."
                : `${resolved.length} saved ${resolved.length === 1 ? "item" : "items"} — tap the heart on a card to remove it.`}
            </Typography>
          </Stack>
          <ResidentNav />

          {resolved.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="Nothing saved yet"
              description="Tap the heart on any service, business, tutor or property to save it here."
              actionLabel="Explore B-17"
              onAction={() => navigate(routes.search)}
            />
          ) : (
            <Stack gap={8}>
              {groups.map(({ kind, entries }) => (
                <WorkspaceSection key={kind} title={`${SAVED_KIND_META[kind].plural} (${entries.length})`}>
                  <motion.div initial="initial" animate="animate" variants={staggerContainer}>
                    <Grid cols={3} gap={4} className="[&_button[aria-pressed]]:size-11">
                      {entries.map(({ item, node }) => (
                        <motion.div key={`${item.kind}-${item.id}`} variants={staggerItem}>
                          {node}
                        </motion.div>
                      ))}
                    </Grid>
                  </motion.div>
                </WorkspaceSection>
              ))}
            </Stack>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { SavedPage }
