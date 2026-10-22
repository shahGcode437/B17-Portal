import { describe, expect, it } from "vitest"
import { toLocationWrite } from "@/features/provider/listingWriteAdapters"
import type { OwnerListingView } from "@/types/ownerListing"

const listing = (location: OwnerListingView["location"]): OwnerListingView => ({ location }) as OwnerListingView

describe("toLocationWrite (the edit form's starting location)", () => {
  it("keeps address and landmark for exact", () => {
    expect(toLocationWrite(listing({ visibility: "exact", block: "C", address: "Shop 4", landmark: "Park", latitude: 33.7, longitude: 73.05 }))).toEqual({
      visibility: "exact",
      block: "C",
      address: "Shop 4",
      landmark: "Park",
      latitude: 33.7,
      longitude: 73.05,
    })
  })

  it("keeps a PRIVATE address and landmark for approximate (dropping them would make an edit a content change)", () => {
    expect(toLocationWrite(listing({ visibility: "approximate", block: "D", address: "House 12", landmark: "Mosque", latitude: 33.71, longitude: 73.06 }))).toEqual({
      visibility: "approximate",
      block: "D",
      address: "House 12",
      landmark: "Mosque",
      latitude: 33.71,
      longitude: 73.06,
    })
  })

  it("keeps a private address for area_only but never a point", () => {
    expect(toLocationWrite(listing({ visibility: "area_only", block: "E", address: "House 3", latitude: 33.7, longitude: 73.05 }))).toEqual({
      visibility: "area_only",
      block: "E",
      address: "House 3",
    })
  })
})
