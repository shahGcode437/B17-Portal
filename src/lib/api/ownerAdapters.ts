import type {
  AdminCategoryDto,
  AdminHistoryEntryDto,
  AdminListingDto,
  AdminListingSummaryDto,
  OwnerListingDto,
  PrivateLocationDto,
} from "@/lib/api/dto/private"
import { isFoodServiceOption, FOOD_VERTICAL_LABEL, foodCategoryLabel } from "@/config/food"
import { businessProfilePath, propertyDetailsPath, providerProfilePath, tutorProfilePath } from "@/config/routes"
import type {
  AdminCategoryView,
  AdminHistoryView,
  AdminListingView,
  AdminQueueRow,
  OwnerListingKind,
  OwnerListingView,
  PrivateLocationView,
} from "@/types/ownerListing"

/**
 * Owner / admin DTO -> view model (Phase 12G). Ids, the canonical status and the revision are kept
 * exactly; nothing is invented (a missing description stays absent). The private location is mapped
 * as the server sent it: these views are only ever shown to the owner or to an admin.
 */

const TYPE_LABELS: Record<OwnerListingKind, string> = {
  provider: "Service / Professional",
  business: "Business / Shop",
  tutor: "Tutor",
  property: "Property",
}

function typeLabel(kind: OwnerListingKind, vertical: "general" | "food" | undefined): string {
  return kind === "business" && vertical === "food" ? FOOD_VERTICAL_LABEL : TYPE_LABELS[kind]
}

function privateLocation(dto: PrivateLocationDto | undefined): PrivateLocationView {
  const location: PrivateLocationView = { visibility: dto?.visibility ?? "area_only" }
  if (dto?.block) location.block = dto.block
  if (dto?.address) location.address = dto.address
  if (dto?.landmark) location.landmark = dto.landmark
  if (typeof dto?.latitude === "number" && typeof dto.longitude === "number") {
    location.latitude = dto.latitude
    location.longitude = dto.longitude
  }
  return location
}

function publicPathFor(listing: OwnerListingDto): string | null {
  if (listing.status !== "approved") return null
  switch (listing.kind) {
    case "provider":
      return providerProfilePath(listing.id)
    case "business":
      return businessProfilePath(listing.id)
    case "tutor":
      return tutorProfilePath(listing.id)
    case "property":
      return propertyDetailsPath(listing.id)
  }
}

function titleOf(listing: OwnerListingDto): string {
  return listing.kind === "property" ? listing.title : listing.name
}

function categoryLineOf(listing: OwnerListingDto): string {
  switch (listing.kind) {
    case "provider":
      return listing.categoryLabel
    case "business": {
      if (listing.vertical === "food") {
        const names = listing.categories.map((ref) => ref.name)
        if (names.length > 0) return names.join(", ")
        return listing.food?.categories.map(foodCategoryLabel).join(", ") ?? listing.categoryLabel
      }
      return listing.category ?? listing.categoryLabel
    }
    case "tutor":
      return `${listing.categoryLabel} · ${listing.grade}`
    case "property":
      return `${listing.propertyType} · ${listing.listingType === "sale" ? "For Sale" : "For Rent"}`
  }
}

export function toOwnerListing(dto: OwnerListingDto): OwnerListingView {
  const vertical = dto.kind === "business" ? dto.vertical : undefined
  const view: OwnerListingView = {
    id: dto.id,
    kind: dto.kind,
    status: dto.status,
    revision: dto.revision,
    title: titleOf(dto),
    typeLabel: typeLabel(dto.kind, vertical),
    categoryLabel: categoryLineOf(dto),
    area: dto.area,
    location: privateLocation(dto.location),
    tags: dto.tags,
    submittedAt: dto.submittedAt,
    updatedAt: dto.updatedAt,
    publicPath: publicPathFor(dto),
  }
  if (vertical) view.vertical = vertical
  // The primary category is the first reference the server lists (a Food listing has several; its own
  // categories travel in `food`). The form submits this SLUG back.
  const primary = dto.categories.find((ref) => ref.isPrimary) ?? dto.categories[0]
  if (primary) view.categorySlug = primary.slug
  if (dto.kind === "tutor") view.grade = dto.grade
  if (dto.kind === "property") {
    view.listingType = dto.listingType
    view.price = dto.price
    if (dto.bedrooms !== undefined) view.bedrooms = dto.bedrooms
    if (dto.furnished) view.furnished = dto.furnished
  }
  if (dto.description) view.description = dto.description
  if (dto.image) view.image = dto.image
  if (dto.rejectionReason) view.rejectionReason = dto.rejectionReason
  if (dto.kind === "business" && dto.vertical === "food" && dto.food) {
    view.food = {
      categories: dto.food.categories,
      serviceOptions: dto.food.serviceOptions.filter(isFoodServiceOption),
      ...(dto.food.hoursNote ? { hoursNote: dto.food.hoursNote } : {}),
      ...(dto.food.menuHighlights?.length ? { menuHighlights: dto.food.menuHighlights } : {}),
      ...(dto.food.menuImage ? { menuImage: dto.food.menuImage } : {}),
    }
  }
  return view
}

function toHistory(entry: AdminHistoryEntryDto): AdminHistoryView {
  return {
    action: entry.action,
    ...(entry.fromStatus ? { fromStatus: entry.fromStatus } : {}),
    toStatus: entry.toStatus,
    revision: entry.revision,
    ...(entry.reason ? { reason: entry.reason } : {}),
    actorName: entry.actor.displayName,
    actorRole: entry.actor.role,
    at: entry.createdAt,
  }
}

export function toAdminListing(dto: AdminListingDto): AdminListingView {
  return {
    ...toOwnerListing(dto),
    ...(dto.submitter ? { submitterName: dto.submitter.displayName } : {}),
    history: dto.history.map(toHistory),
  }
}

export function toAdminQueueRow(dto: AdminListingSummaryDto): AdminQueueRow {
  return {
    id: dto.id,
    kind: dto.kind,
    ...(dto.vertical ? { vertical: dto.vertical } : {}),
    title: dto.title,
    typeLabel: typeLabel(dto.kind, dto.vertical),
    categoryLabel: dto.categoryLabel,
    area: dto.area,
    ...(dto.block ? { block: dto.block } : {}),
    locationVisibility: dto.locationVisibility,
    status: dto.status,
    revision: dto.revision,
    ...(dto.submitter ? { submitterName: dto.submitter.displayName } : {}),
    submittedAt: dto.submittedAt,
  }
}

export function toAdminCategory(dto: AdminCategoryDto): AdminCategoryView {
  return {
    id: dto.id,
    module: dto.module,
    slug: dto.slug,
    name: dto.name,
    ...(dto.parentId ? { parentId: dto.parentId } : {}),
    displayOrder: dto.displayOrder,
    isActive: dto.isActive,
  }
}
