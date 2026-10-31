import type { ListingStatus } from "@/types/listing"

const STATUS_LABELS: Record<ListingStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
}

/** What a moderator's removal of a listing that was LIVE is called (a refusal before it went live is "Rejected"). */
export const TAKEN_DOWN_LABEL = "Taken down"

/**
 * The label for a status: "Rejected" for a listing refused before it was ever live, "Taken down" for a listing a
 * moderator removed after it was approved. The status itself is `rejected` for both (S5A / B-03); the marker never
 * changes any other status.
 */
export function listingStatusLabel(status: ListingStatus, takenDown = false): string {
  return status === "rejected" && takenDown ? TAKEN_DOWN_LABEL : STATUS_LABELS[status]
}
