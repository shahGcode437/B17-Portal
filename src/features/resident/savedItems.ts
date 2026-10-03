import { Wrench, Building2, GraduationCap, KeyRound } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SavedItem, SavedItemKind } from "@/types/resident"
import { getProviderById, getBusinessById, getTutorById, getPropertyById } from "@/services/search"
import { providerProfilePath, businessProfilePath, tutorProfilePath, propertyDetailsPath } from "@/config/routes"

/** How each saved kind is named to a resident — the domain label shown on the Saved page and Overview. */
export const SAVED_KIND_META: Record<SavedItemKind, { label: string; plural: string; icon: LucideIcon }> = {
  provider: { label: "Service", plural: "Services", icon: Wrench },
  business: { label: "Business", plural: "Businesses", icon: Building2 },
  tutor: { label: "Tutor", plural: "Tutors", icon: GraduationCap },
  property: { label: "Property", plural: "Properties", icon: KeyRound },
}

export interface ResolvedSavedItem {
  item: SavedItem
  title: string
  /** Secondary line, built from the live item's own fields (category/subject/area) — never invented. */
  subtitle: string
  path: string
}

/**
 * Resolves a `{kind, id}` reference through the public `search.ts` boundary
 * (the same one the detail pages use). Returns `null` when the live item is
 * gone, so callers can skip it — the store only ever holds the reference.
 */
export function resolveSavedItem(item: SavedItem): ResolvedSavedItem | null {
  if (item.kind === "provider") {
    const provider = getProviderById(item.id)
    return provider
      ? { item, title: provider.name, subtitle: `${provider.categoryLabel} · ${provider.area}`, path: providerProfilePath(provider.id) }
      : null
  }
  if (item.kind === "business") {
    const business = getBusinessById(item.id)
    return business
      ? { item, title: business.name, subtitle: `${business.category} · ${business.area}`, path: businessProfilePath(business.id) }
      : null
  }
  if (item.kind === "tutor") {
    const tutor = getTutorById(item.id)
    return tutor
      ? { item, title: tutor.name, subtitle: `${tutor.subject} · ${tutor.area}`, path: tutorProfilePath(tutor.id) }
      : null
  }
  const property = getPropertyById(item.id)
  return property
    ? { item, title: property.title, subtitle: `${property.propertyType} · ${property.area}`, path: propertyDetailsPath(property.id) }
    : null
}
