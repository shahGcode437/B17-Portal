import { beforeEach, describe, expect, it } from "vitest"
import {
  isListingCountedTowardPlanLimit,
  selectActiveListingsBySubmitter,
  selectListingsBySubmitter,
  useListingsStore,
} from "@/state/listingsStore"
import { useResidentStore } from "@/state/residentStore"
import { businessCategoryLabel, businessTypeIcon, businessTypeLabel } from "@/features/provider/listingDisplay"
import type { PendingListing } from "@/types/listing"
import type { Business } from "@/types/business"

function businessListing(id: string, submittedBy = "Ayesha"): PendingListing {
  return {
    id,
    kind: "business",
    status: "pending",
    submittedAt: "2026-10-01T00:00:00.000Z",
    submittedBy,
    data: { id, name: `Shop ${id}`, vertical: "general", category: "Stationery", description: "A shop.", area: "B-17", tags: [] },
  }
}

const statusOf = (id: string) => useListingsStore.getState().listings.find((l) => l.id === id)?.status

beforeEach(() => {
  useListingsStore.setState({ listings: [] })
  useResidentStore.setState({ savedItems: [], requests: [] })
})

describe("listing lifecycle (listingsStore)", () => {
  it("moves pending → rejected (with reason) → pending again on resubmit, clearing the reason", () => {
    const { submitListing, setStatus, resubmitListing } = useListingsStore.getState()
    submitListing(businessListing("a"))
    expect(statusOf("a")).toBe("pending")

    setStatus("a", "rejected", "Please add more detail.")
    const rejected = useListingsStore.getState().listings[0]
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "Please add more detail." })

    resubmitListing("a", { ...(rejected.data as Business), name: "Shop a (edited)" })
    const resubmitted = useListingsStore.getState().listings[0]
    expect(resubmitted.status).toBe("pending")
    expect(resubmitted.rejectionReason).toBeUndefined()
    expect((resubmitted.data as Business).name).toBe("Shop a (edited)")
    expect(useListingsStore.getState().listings).toHaveLength(1) // edited in place, never duplicated
  })

  it("approves and archives without touching other listings or the data", () => {
    const { submitListing, setStatus, archiveListing } = useListingsStore.getState()
    submitListing(businessListing("a"))
    submitListing(businessListing("b"))
    setStatus("a", "approved")
    archiveListing("a")
    expect(statusOf("a")).toBe("archived")
    expect(statusOf("b")).toBe("pending")
    expect((useListingsStore.getState().listings[0].data as Business).name).toBe("Shop a")
  })
})

describe("quota rule", () => {
  it("counts only pending and approved listings toward the plan limit", () => {
    expect(isListingCountedTowardPlanLimit("pending")).toBe(true)
    expect(isListingCountedTowardPlanLimit("approved")).toBe(true)
    expect(isListingCountedTowardPlanLimit("rejected")).toBe(false)
    expect(isListingCountedTowardPlanLimit("archived")).toBe(false)
  })

  it("scopes ownership by submitter and keeps archived/rejected visible in management but out of the quota", () => {
    const { submitListing, setStatus, archiveListing } = useListingsStore.getState()
    submitListing(businessListing("a", "Ayesha"))
    submitListing(businessListing("b", "Ayesha"))
    submitListing(businessListing("c", "Ayesha"))
    submitListing(businessListing("z", "Someone Else"))
    setStatus("b", "rejected", "reason that is long enough")
    archiveListing("c")
    const { listings } = useListingsStore.getState()
    expect(selectListingsBySubmitter(listings, "Ayesha")).toHaveLength(3)
    expect(selectActiveListingsBySubmitter(listings, "Ayesha").map((l) => l.id)).toEqual(["a"])
    expect(selectListingsBySubmitter(listings, "Someone Else")).toHaveLength(1)
  })
})

describe("Saved items (residentStore)", () => {
  it("toggles a saved business by reference — kind, id and a timestamp only — and unsaves it", () => {
    const { toggleSaved } = useResidentStore.getState()
    toggleSaved("business", "business-08")
    expect(useResidentStore.getState().savedItems).toEqual([{ kind: "business", id: "business-08", savedAt: expect.any(String) }])
    toggleSaved("business", "business-08")
    expect(useResidentStore.getState().savedItems).toEqual([])
  })

  it("distinguishes the same id under different kinds", () => {
    const { toggleSaved } = useResidentStore.getState()
    toggleSaved("business", "x1")
    toggleSaved("provider", "x1")
    expect(useResidentStore.getState().savedItems).toHaveLength(2)
  })
})

describe("listing display helpers", () => {
  const food: Business = {
    id: "f1",
    name: "Cafe",
    vertical: "food",
    category: "Cafes",
    description: "x",
    area: "B-17",
    tags: [],
    food: { categories: ["cafes", "tea-snacks"], serviceOptions: ["dine-in"] },
  }
  const general: Business = { id: "g1", name: "Shop", vertical: "general", category: "Grocery", description: "x", area: "B-17", tags: [] }

  it("labels a Food business as Food & Dining and lists primary then secondary categories", () => {
    expect(businessTypeLabel(food, "Business / Shop")).toBe("Food & Dining")
    expect(businessCategoryLabel(food)).toBe("Cafes, Tea / Snacks")
  })

  it("leaves a General business unchanged", () => {
    expect(businessTypeLabel(general, "Business / Shop")).toBe("Business / Shop")
    expect(businessCategoryLabel(general)).toBe("Grocery")
    expect(businessTypeIcon(general)).not.toBe(businessTypeIcon(food))
  })
})
