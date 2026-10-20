import { Wrench, Building2, GraduationCap, KeyRound } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SavedItemKind } from "@/types/resident"
import type { SavedEntry } from "@/lib/api/privateAdapters"
import { providerProfilePath, businessProfilePath, tutorProfilePath, propertyDetailsPath } from "@/config/routes"

/** How each saved kind is named to a resident - the domain label shown on the Saved page and Overview. */
export const SAVED_KIND_META: Record<SavedItemKind, { label: string; plural: string; icon: LucideIcon }> = {
  provider: { label: "Service", plural: "Services", icon: Wrench },
  business: { label: "Business", plural: "Businesses", icon: Building2 },
  tutor: { label: "Tutor", plural: "Tutors", icon: GraduationCap },
  property: { label: "Property", plural: "Properties", icon: KeyRound },
}

export interface DescribedSavedEntry {
  entry: SavedEntry
  kind: SavedItemKind
  id: string
  title: string
  /** Secondary line, built from the listing's own public fields (category / subject / area). */
  subtitle: string
  path: string
}

/**
 * Titles and links for a saved entry, derived from the PUBLIC card the Saved API returned. Nothing is
 * looked up elsewhere any more (the old version resolved a stored `{kind, id}` through local data):
 * the server only returns listings that are still approved.
 */
export function describeSavedEntry(entry: SavedEntry): DescribedSavedEntry {
  const { hit } = entry
  switch (hit.kind) {
    case "provider":
      return {
        entry,
        kind: "provider",
        id: hit.item.id,
        title: hit.item.name,
        subtitle: `${hit.item.categoryLabel} · ${hit.item.area}`,
        path: providerProfilePath(hit.item.id),
      }
    case "business":
      return {
        entry,
        kind: "business",
        id: hit.item.id,
        title: hit.item.name,
        subtitle: `${hit.item.category} · ${hit.item.area}`,
        path: businessProfilePath(hit.item.id),
      }
    case "tutor":
      return {
        entry,
        kind: "tutor",
        id: hit.item.id,
        title: hit.item.name,
        subtitle: `${hit.item.subject} · ${hit.item.area}`,
        path: tutorProfilePath(hit.item.id),
      }
    case "property":
      return {
        entry,
        kind: "property",
        id: hit.item.id,
        title: hit.item.title,
        subtitle: `${hit.item.propertyType} · ${hit.item.area}`,
        path: propertyDetailsPath(hit.item.id),
      }
  }
}
