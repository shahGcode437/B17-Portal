import { screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { toOwnerListing } from "@/lib/api/ownerAdapters"
import type { OwnerListingDto } from "@/lib/api/dto/private"
import { installFetchMock, meBody, ok, type MockCall } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, OWNER_LISTINGS, PRIVATE_ADDRESS, PRIVATE_POINT } from "@/test/fixtures/apiFixtures"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * The owner's "View" (Phase 12S Step A): the stored photo (or the placeholder), the status, the human category and the
 * listing's own facts - for a property its sale / rent, type, price, bedrooms and furnishing - from fields the owner
 * API already returns. No new request, nothing private in the facts, no public-preview route.
 */
afterEach(() => vi.unstubAllGlobals())

const PROPERTY = {
  ...OWNER_LISTINGS[2],
  status: "approved",
  title: "Corner House, Block C",
  listingType: "rent",
  propertyType: "house",
  categoryLabel: "House",
  price: "PKR 85,000 / month",
  bedrooms: 3,
  furnished: "Semi-Furnished",
  image: "/images/properties/corner-house.jpg",
  rejectionReason: undefined,
  location: { visibility: "exact", block: "C", address: PRIVATE_ADDRESS, ...PRIVATE_POINT },
} as OwnerListingDto

/** Opens the preview of `dto` the way the dashboard does: the row's view model, then the dialog's own fresh read. */
function open(dto: OwnerListingDto) {
  const calls: MockCall[] = []
  const base = fakeBackend({ me: meBody({ roles: ["professional"] }), overrides: { [`/users/me/listings/${dto.id}`]: ok(dto) } })
  installFetchMock((call) => {
    calls.push(call)
    return base(call)
  })
  const view = toOwnerListing(dto)
  renderPage(<ListingPreviewDialog listing={view} onOpenChange={vi.fn()} />, { url: "/provider/listings", user: testUser() })
  return { calls, view }
}

describe("the owner preview of a property", () => {
  it("shows sale / rent, type, price, bedrooms and furnishing, the human category and the status", async () => {
    open(PROPERTY)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Corner House, Block C")).toBeInTheDocument()
    expect(within(dialog).getByText("Approved")).toBeInTheDocument()
    // The category line is the human name (never a slug): "Property · House · For Rent".
    expect(within(dialog).getByText("Property · House · For Rent")).toBeInTheDocument()

    const facts = within(dialog).getByRole("region", { name: "Listing details" })
    const rows = Object.fromEntries(Array.from(facts.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]))
    expect(rows).toEqual({
      Listing: "For Rent",
      "Property type": "House",
      Price: "PKR 85,000 / month",
      Bedrooms: "3",
      Furnishing: "Semi-Furnished",
    })
  })

  it("shows the area and block in the location block, and keeps the facts free of the private address and point", async () => {
    open(PROPERTY)
    const dialog = await screen.findByRole("dialog")
    const location = await within(dialog).findByRole("region", { name: "Location" })
    expect(location).toHaveTextContent("B-17")
    expect(location).toHaveTextContent("C") // Block
    const facts = within(dialog).getByRole("region", { name: "Listing details" })
    expect(facts.textContent).not.toContain(PRIVATE_ADDRESS)
    expect(facts.textContent).not.toContain(String(PRIVATE_POINT.latitude))
    expect(facts.textContent).not.toContain(String(PRIVATE_POINT.longitude))
  })

  it("leaves out a fact the owner did not give (a plot has no bedrooms or furnishing) rather than inventing one", async () => {
    open({ ...PROPERTY, bedrooms: undefined, furnished: undefined, propertyType: "plot", categoryLabel: "Plot" } as OwnerListingDto)
    const dialog = await screen.findByRole("dialog")
    const facts = within(dialog).getByRole("region", { name: "Listing details" })
    expect(facts).toHaveTextContent("Plot")
    expect(facts).not.toHaveTextContent("Bedrooms")
    expect(facts).not.toHaveTextContent("Furnishing")
  })

  it("makes no request beyond the one fresh read of the listing, and has no public-preview route", async () => {
    const { calls } = open(PROPERTY)
    await within(await screen.findByRole("dialog")).findByRole("region", { name: "Location" })
    const requests = calls.filter((call) => call.path !== "/auth/me" && call.path !== "/categories").map((call) => `${call.method} ${call.path}`)
    expect(requests).toEqual([`GET /users/me/listings/${PROPERTY.id}`])
  })
})

describe("the photo in the owner preview", () => {
  it("shows the stored photo, named for the listing", async () => {
    open(PROPERTY)
    const dialog = await screen.findByRole("dialog")
    const photo = within(dialog).getByRole("img", { name: "Corner House, Block C" })
    expect(photo).toHaveAttribute("src", "/images/properties/corner-house.jpg")
    expect(within(dialog).queryByRole("img", { name: /No photo available/ })).not.toBeInTheDocument()
  })

  it("shows the placeholder, which says there is no photo, when none is stored", async () => {
    open({ ...PROPERTY, image: undefined } as OwnerListingDto)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("img", { name: "No photo available for Corner House, Block C" })).toBeInTheDocument()
    expect(dialog.querySelector("img")).toBeNull()
  })
})

describe("the owner preview of the other kinds (existing data only)", () => {
  it("a tutor shows the grade; a service and a business show no invented facts block", async () => {
    const tutor = OWNER_LISTINGS.find((l) => l.id === IDS.ownerArchived) as OwnerListingDto
    open(tutor)
    const dialog = await screen.findByRole("dialog")
    const facts = within(dialog).getByRole("region", { name: "Listing details" })
    expect(facts).toHaveTextContent("Grade / level")
    expect(facts).toHaveTextContent("Grade 8")
    expect(within(dialog).getByText("Tutor · English · Grade 8")).toBeInTheDocument()
  })

  it("a service keeps its category, description and tags, with no facts block of its own", async () => {
    const service = OWNER_LISTINGS.find((l) => l.id === IDS.ownerApproved) as OwnerListingDto
    open(service)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Service / Professional · Plumbing")).toBeInTheDocument()
    expect(within(dialog).getByText(/Plumbing repairs and fittings/)).toBeInTheDocument()
    expect(await within(dialog).findByText("demo")).toBeInTheDocument()
    expect(within(dialog).queryByRole("region", { name: "Listing details" })).not.toBeInTheDocument()
  })

  it("an approved listing links to its real public page; a pending one has none (moderation is not bypassed)", async () => {
    open(PROPERTY)
    expect(within(await screen.findByRole("dialog")).getByRole("button", { name: "View Public Listing" })).toBeInTheDocument()
  })

  it("a pending listing offers no public link", async () => {
    open(OWNER_LISTINGS.find((l) => l.id === IDS.ownerPending) as OwnerListingDto)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("button", { name: "View Public Listing" })).not.toBeInTheDocument()
  })
})
