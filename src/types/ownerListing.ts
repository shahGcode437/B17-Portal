import type { FoodServiceOption } from "@/config/food"
import type { ListingStatus } from "@/types/listing"
import type { LocationVisibility } from "@/types/location"

/**
 * View models of a listing as its OWNER or an ADMIN sees it (Phase 12G). They are deliberately
 * separate from the public `Provider` / `Business` / `Tutor` / `Property` models: they carry the
 * moderation state (`status`, `revision`, a rejection reason) and the PRIVATE location the owner
 * entered, none of which a public page may ever receive.
 */
export interface PrivateLocationView {
  visibility: LocationVisibility
  block?: string
  address?: string
  landmark?: string
  latitude?: number
  longitude?: number
}

export type OwnerListingKind = "provider" | "business" | "tutor" | "property"

export interface OwnerFoodView {
  categories: string[]
  serviceOptions: FoodServiceOption[]
  hoursNote?: string
  /** Kept so an edit does not silently drop the menu (a PATCH replaces the whole Food block). */
  menuHighlights?: { id: string; name: string; section?: string; description?: string; price?: string }[]
  menuImage?: string
}

export interface OwnerListingView {
  id: string
  kind: OwnerListingKind
  vertical?: "general" | "food"
  status: ListingStatus
  /** The server's content version; a decision or an edit refers to it. */
  revision: number
  title: string
  /** "Service / Professional", "Business / Shop", "Food & Dining", "Tutor" or "Property". */
  typeLabel: string
  /** The category line: "Solar", "Bakeries, Sweets / Desserts", "Physics · Grade 9", "House · For Sale". */
  categoryLabel: string
  area: string
  location: PrivateLocationView
  description?: string
  image?: string
  tags: string[]
  rejectionReason?: string
  /**
   * True only while the listing is `rejected` because a moderator TOOK DOWN a listing that was live (S5A,
   * B-03). A listing refused before it ever went live is a plain rejection and leaves this absent; the status
   * is `rejected` either way, so this is what tells the two apart.
   */
  takenDown?: boolean
  submittedAt: string
  updatedAt: string
  food?: OwnerFoodView
  /**
   * What the EDIT form needs to prefill, kept apart from the display strings above: the primary
   * category SLUG (the form submits slugs, never labels), a tutor's grade and a property's own fields.
   */
  categorySlug?: string
  /** A tutor's subject (the category's human name), so a review can show Subject and Grade apart. */
  subjectLabel?: string
  grade?: string
  listingType?: "sale" | "rent"
  /** The property type's human name ("Flat", "Plot"); `categoryLabel` above is the combined line ("Flat · For Rent"). */
  propertyTypeLabel?: string
  price?: string
  bedrooms?: number
  furnished?: "Furnished" | "Unfurnished" | "Semi-Furnished"
  /** Where the PUBLIC page lives, only when the listing is approved (the server 404s it otherwise). */
  publicPath: string | null
}

export interface AdminHistoryView {
  action: "submitted" | "resubmitted" | "approved" | "rejected" | "archived"
  fromStatus?: ListingStatus
  toStatus: ListingStatus
  revision: number
  reason?: string
  actorName: string
  actorRole: "owner" | "admin"
  at: string
}

/** The full review view of a listing: the owner view plus who submitted it and what happened to it. */
export interface AdminListingView extends OwnerListingView {
  submitterName?: string
  history: AdminHistoryView[]
}

/** One row of the moderation queue: no location detail, only the visibility mode. */
export interface AdminQueueRow {
  id: string
  kind: OwnerListingKind
  vertical?: "general" | "food"
  title: string
  typeLabel: string
  categoryLabel: string
  area: string
  block?: string
  locationVisibility: LocationVisibility
  status: ListingStatus
  revision: number
  /** True only while `rejected` because a moderator took down a live listing (the same marker as the review view). */
  takenDown?: boolean
  submitterName?: string
  submittedAt: string
}

export interface AdminCategoryView {
  id: string
  module: "services" | "directory" | "food" | "education" | "property" | "news"
  slug: string
  name: string
  parentId?: string
  displayOrder: number
  isActive: boolean
}
