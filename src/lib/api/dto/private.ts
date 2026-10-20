/**
 * PRIVATE backend read shapes (Phase 12G): the signed-in owner's own listings, the admin
 * moderation surface, Saved items and service requests. These contain data the public must never
 * see (the stored private location, revision, moderation state, a requester's text), so they live
 * apart from `public.ts` and are imported only by the owner / admin / resident / provider screens.
 */
import type {
  BusinessDto,
  CategoryRefDto,
  FoodDto,
  LocationDto,
  LocationVisibility,
  PropertyDto,
  ProviderDto,
  TutorDto,
} from "@/lib/api/dto/public"

export type ListingStatusDto = "pending" | "approved" | "rejected" | "archived"

export interface StatusCountsDto {
  pending: number
  approved: number
  rejected: number
  archived: number
}

/** The owner's / admin's view of where a listing is — INCLUDING the stored, private point. */
export interface PrivateLocationDto {
  visibility: LocationVisibility
  block?: string
  address?: string
  landmark?: string
  latitude?: number
  longitude?: number
}

interface OwnerFieldsDto {
  id: string
  status: ListingStatusDto
  revision: number
  area: string
  location: PrivateLocationDto
  /** What the public currently sees (so the owner can preview it). */
  publicLocation: LocationDto
  description?: string
  image?: string
  tags: string[]
  categories: CategoryRefDto[]
  categoryLabel: string
  rejectionReason?: string
  featured?: boolean
  submittedAt: string
  createdAt: string
  updatedAt: string
}

export interface OwnerProviderDto extends OwnerFieldsDto {
  kind: "provider"
  name: string
  category: string
}

export interface OwnerBusinessDto extends OwnerFieldsDto {
  kind: "business"
  name: string
  vertical: "general" | "food"
  category?: string
  food?: FoodDto
}

export interface OwnerTutorDto extends OwnerFieldsDto {
  kind: "tutor"
  name: string
  category: string
  grade: string
}

export interface OwnerPropertyDto extends OwnerFieldsDto {
  kind: "property"
  title: string
  listingType: "sale" | "rent"
  propertyType: string
  price: string
  bedrooms?: number
  furnished?: "Furnished" | "Unfurnished" | "Semi-Furnished"
}

export type OwnerListingDto = OwnerProviderDto | OwnerBusinessDto | OwnerTutorDto | OwnerPropertyDto

// -- admin -------------------------------------------------------------------------------------

export interface AdminSubmitterDto {
  displayName: string
}

export type HistoryActionDto = "submitted" | "resubmitted" | "approved" | "rejected" | "archived"

export interface AdminHistoryEntryDto {
  action: HistoryActionDto
  fromStatus?: ListingStatusDto
  toStatus: ListingStatusDto
  revision: number
  reason?: string
  actor: { displayName: string; role: "owner" | "admin" }
  createdAt: string
}

/** One queue row: deliberately has NO location detail, only the visibility mode. */
export interface AdminListingSummaryDto {
  id: string
  kind: "provider" | "business" | "tutor" | "property"
  vertical?: "general" | "food"
  title: string
  area: string
  block?: string
  locationVisibility: LocationVisibility
  categoryLabel: string
  status: ListingStatusDto
  revision: number
  featured?: boolean
  submittedAt: string
  updatedAt: string
  submitter?: AdminSubmitterDto
}

interface AdminExtrasDto {
  submitter?: AdminSubmitterDto
  history: AdminHistoryEntryDto[]
}

export type AdminListingDto =
  | (OwnerProviderDto & AdminExtrasDto)
  | (OwnerBusinessDto & AdminExtrasDto)
  | (OwnerTutorDto & AdminExtrasDto)
  | (OwnerPropertyDto & AdminExtrasDto)

export interface AdminCategoryDto {
  id: string
  module: "services" | "directory" | "food" | "education" | "property" | "news"
  slug: string
  name: string
  parentId?: string
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// -- Saved ---------------------------------------------------------------------------------------

/** A saved listing: the PUBLIC card plus when it was saved (news is never saveable). */
export type SavedHitDto =
  | { kind: "provider"; item: ProviderDto; savedAt: string }
  | { kind: "business"; item: BusinessDto; savedAt: string }
  | { kind: "tutor"; item: TutorDto; savedAt: string }
  | { kind: "property"; item: PropertyDto; savedAt: string }

// -- service requests ------------------------------------------------------------------------------

export type RequestStatusDto = "submitted" | "accepted" | "in-progress" | "completed" | "cancelled"
export type ContactChannelDto = "in_app" | "whatsapp" | "phone"

interface RequestFieldsDto {
  id: string
  /** Absent only if the listing was hard-deleted; `providerName` is the snapshot taken at creation. */
  providerListingId?: string
  providerName: string
  service: string
  details: string
  area: string
  /** `YYYY-MM-DD`. */
  preferredDate: string
  preferredTime?: string
  notes?: string
  preferredContactChannel: ContactChannelDto
  status: RequestStatusDto
  createdAt: string
  updatedAt: string
}

/** The requester's own list row. */
export type RequestSummaryDto = RequestFieldsDto

/** The provider's inbox row: the requester appears by display name only. */
export interface LeadSummaryDto extends RequestFieldsDto {
  requesterName: string
}

export interface RequestHistoryEntryDto {
  fromStatus?: RequestStatusDto
  toStatus: RequestStatusDto
  actorRole: "requester" | "provider"
  createdAt: string
}

export interface RequestDetailDto extends LeadSummaryDto {
  viewerRole: "requester" | "provider"
  history: RequestHistoryEntryDto[]
}
