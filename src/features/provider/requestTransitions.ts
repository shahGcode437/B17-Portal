import type { RequestStatus } from "@/types/resident"

/**
 * Manual, professional-initiated status transitions (Phase 9D). No timers,
 * no automatic transitions — a professional clicks one of these to move a
 * lead forward. Terminal statuses ("completed"/"cancelled") have no further
 * transitions.
 */
export const REQUEST_TRANSITIONS: Record<RequestStatus, { next: RequestStatus; label: string }[]> = {
  submitted: [
    { next: "accepted", label: "Accept" },
    { next: "cancelled", label: "Cancel" },
  ],
  accepted: [
    { next: "in-progress", label: "Mark In Progress" },
    { next: "cancelled", label: "Cancel" },
  ],
  "in-progress": [
    { next: "completed", label: "Mark Completed" },
    { next: "cancelled", label: "Cancel" },
  ],
  completed: [],
  cancelled: [],
}
