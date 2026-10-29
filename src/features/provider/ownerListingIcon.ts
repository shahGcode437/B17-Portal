import { Wrench, Building2, KeyRound, GraduationCap, Utensils } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { OwnerListingKind, OwnerListingView } from "@/types/ownerListing"

const kindIcon: Record<OwnerListingKind, LucideIcon> = {
  provider: Wrench,
  business: Building2,
  tutor: GraduationCap,
  property: KeyRound,
}

/** The placeholder icon of an owner's listing when it has no photo: Food & Dining has its own, otherwise by kind. */
export function ownerListingIcon(listing: Pick<OwnerListingView, "kind" | "vertical">): LucideIcon {
  return listing.vertical === "food" ? Utensils : kindIcon[listing.kind]
}
