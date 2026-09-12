import type { PendingListing } from "@/types/listing"

/**
 * Seed pending listings (Prototype Data Contract: 2–3) so the future Admin
 * moderation queue isn't empty before anyone submits live. Fictional demo
 * data only — not tied to the current session's own submission.
 */
export const pendingListingsSeed: PendingListing[] = [
  {
    id: "pending-seed-01",
    kind: "provider",
    status: "pending",
    submittedAt: "2026-09-08T10:00:00.000Z",
    submittedBy: "Zara H.",
    data: {
      id: "pending-seed-01",
      name: "B-17 Aluminium Works (Demo)",
      category: "aluminium",
      categoryLabel: "Aluminium",
      description: "Aluminium windows, railings and glass partition installation for homes.",
      area: "B-17, Block E (Demo Area)",
      tags: ["aluminium", "windows", "railings", "glass"],
    },
  },
  {
    id: "pending-seed-02",
    kind: "business",
    status: "pending",
    submittedAt: "2026-09-09T14:30:00.000Z",
    submittedBy: "Usman T.",
    data: {
      id: "pending-seed-02",
      name: "Capital Stationery Mart (Demo)",
      category: "Stationery",
      description: "Office and school stationery, printing and photocopying services.",
      area: "B-17, Block A (Demo Area)",
      tags: ["stationery", "printing", "photocopy"],
    },
  },
]
