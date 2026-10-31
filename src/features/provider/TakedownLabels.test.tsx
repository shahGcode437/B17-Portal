import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditListingPage } from "@/features/provider/EditListingPage"
import { ListingPreviewDialog } from "@/features/provider/ListingPreviewDialog"
import { ListingStatusBadge } from "@/features/provider/ListingStatusBadge"
import { listingStatusLabel } from "@/features/provider/listingStatusLabel"
import { ListingSummaryCard } from "@/features/provider/ListingSummaryCard"
import { ProfessionalOverviewPage } from "@/features/provider/ProfessionalOverviewPage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { toOwnerListing } from "@/lib/api/ownerAdapters"
import type { OwnerListingDto } from "@/lib/api/dto/private"
import { installFetchMock, meBody, ok, okPage } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, OWNER_LISTINGS } from "@/test/fixtures/apiFixtures"
import { testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * B-03 (S5A): the owner is told whether a listing was REJECTED before it ever went live or TAKEN DOWN after it was
 * approved. The status is `rejected` for both; the owner API's `takenDown` marker (derived on the backend from the
 * history) is the only thing that tells them apart, so every owner surface reads it from the one place.
 */
afterEach(() => vi.unstubAllGlobals())

const REASON = "Reported as closed; please confirm you still trade."
const approved = OWNER_LISTINGS.find((l) => l.id === IDS.ownerApproved) as OwnerListingDto
const rejected = OWNER_LISTINGS.find((l) => l.id === IDS.ownerRejected) as OwnerListingDto

/** A listing that was live and then removed by a moderator, as the owner API returns it. */
const TAKEN_DOWN = { ...approved, status: "rejected", rejectionReason: REASON, takenDown: true } as OwnerListingDto

describe("the label", () => {
  it("a rejected listing is Rejected, a taken-down one is Taken down", () => {
    expect(listingStatusLabel("rejected")).toBe("Rejected")
    expect(listingStatusLabel("rejected", false)).toBe("Rejected")
    expect(listingStatusLabel("rejected", true)).toBe("Taken down")
  })

  it("the marker never changes any other status", () => {
    expect(listingStatusLabel("approved", true)).toBe("Approved")
    expect(listingStatusLabel("pending", true)).toBe("Pending Review")
    expect(listingStatusLabel("archived", true)).toBe("Archived")
  })

  it("the badge shows the label as text (never a colour or icon alone)", () => {
    const { rerender } = render(<ListingStatusBadge status="rejected" />)
    expect(screen.getByText("Rejected")).toBeInTheDocument()
    rerender(<ListingStatusBadge status="rejected" takenDown />)
    expect(screen.getByText("Taken down")).toBeInTheDocument()
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument()
  })
})

describe("the adapter", () => {
  it("keeps the marker only on a rejected listing", () => {
    expect(toOwnerListing(TAKEN_DOWN).takenDown).toBe(true)
    expect(toOwnerListing(rejected).takenDown).toBeUndefined()
    // Never trusted on a listing that is not rejected (an owner edit puts it back to pending).
    expect(toOwnerListing({ ...TAKEN_DOWN, status: "pending" } as OwnerListingDto).takenDown).toBeUndefined()
  })
})

describe("the owner's listing card", () => {
  const card = (dto: OwnerListingDto) =>
    render(
      <MemoryRouter>
        <ListingSummaryCard listing={toOwnerListing(dto)} />
      </MemoryRouter>
    )

  it("a taken-down listing reads Taken down, with the moderator's reason", () => {
    card(TAKEN_DOWN)
    expect(screen.getByText("Taken down")).toBeInTheDocument()
    expect(screen.getByText("Taken down:")).toBeInTheDocument()
    expect(screen.getByText(REASON, { exact: false })).toBeInTheDocument()
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument()
  })

  it("a listing rejected before it was live reads Rejected, with a Reason", () => {
    card(rejected)
    expect(screen.getByText("Rejected")).toBeInTheDocument()
    expect(screen.getByText("Reason:")).toBeInTheDocument()
    expect(screen.queryByText("Taken down")).not.toBeInTheDocument()
  })
})

describe("the owner's View dialog", () => {
  function open(dto: OwnerListingDto) {
    installFetchMock(
      fakeBackend({ me: meBody({ roles: ["professional"] }), overrides: { [`/users/me/listings/${dto.id}`]: ok(dto) } })
    )
    renderPage(<ListingPreviewDialog listing={toOwnerListing(dto)} onOpenChange={vi.fn()} />, {
      url: "/provider/listings",
      user: testUser(),
    })
    return screen.findByRole("dialog")
  }

  it("a taken-down listing: Taken down badge and reason, and it stays so after the fresh read", async () => {
    const dialog = await open(TAKEN_DOWN)
    expect(within(dialog).getByText("Taken down")).toBeInTheDocument()
    expect(await within(dialog).findByRole("region", { name: "Location" })).toBeInTheDocument()
    expect(within(dialog).getByText("Taken down:")).toBeInTheDocument()
    expect(within(dialog).queryByText("Rejected")).not.toBeInTheDocument()
    // Not live: there is no public page to link to.
    expect(within(dialog).queryByRole("button", { name: "View Public Listing" })).not.toBeInTheDocument()
  })

  it("a rejected listing: Rejected badge and a Reason", async () => {
    const dialog = await open(rejected)
    expect(within(dialog).getByText("Rejected")).toBeInTheDocument()
    expect(await within(dialog).findByText("Reason:")).toBeInTheDocument()
    expect(within(dialog).queryByText("Taken down")).not.toBeInTheDocument()
  })
})

describe("the Edit page", () => {
  function edit(dto: OwnerListingDto) {
    installFetchMock(
      fakeBackend({ me: meBody({ roles: ["professional"] }), overrides: { [`/users/me/listings/${dto.id}`]: ok(dto) } })
    )
    resetCategoryCache()
    renderPage(<EditListingPage />, {
      url: `/provider/listings/${dto.id}/edit`,
      path: "/provider/listings/:id/edit",
      user: testUser(),
    })
  }

  it("a taken-down listing explains it was taken down and still offers the resubmit", async () => {
    edit(TAKEN_DOWN)
    expect(await screen.findByRole("button", { name: "Resubmit for Review" })).toBeInTheDocument()
    expect(screen.getByText("Taken down")).toBeInTheDocument()
    expect(screen.getByText(/A moderator took this listing down/)).toBeInTheDocument()
    expect(screen.getByText(`Taken down: ${REASON}`)).toBeInTheDocument()
    expect(screen.queryByText(/^Rejected:/)).not.toBeInTheDocument()
  })

  it("a listing rejected before it was live keeps the existing rejection copy", async () => {
    edit(rejected)
    expect(await screen.findByRole("button", { name: "Resubmit for Review" })).toBeInTheDocument()
    expect(screen.getByText("Edit what the review asked for, then resubmit.")).toBeInTheDocument()
    expect(screen.getByText(/^Rejected: Please add the plot size/)).toBeInTheDocument()
    expect(screen.queryByText(/took this listing down/)).not.toBeInTheDocument()
  })
})

describe("the dashboard", () => {
  it("a recent taken-down listing reads Taken down, and the count tile covers both", async () => {
    installFetchMock(
      fakeBackend({
        me: meBody({ roles: ["professional"] }),
        overrides: { "/users/me/listings": okPage([TAKEN_DOWN], { counts: { pending: 0, approved: 0, rejected: 1, archived: 0 } }) },
      })
    )
    renderPage(<ProfessionalOverviewPage />, { url: "/provider", user: testUser() })
    expect(await screen.findByText("Taken down")).toBeInTheDocument()
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument()
    // The tile counts every rejected-status listing, so its label names both.
    expect(screen.getAllByText("Rejected / taken down").length).toBeGreaterThan(0)
  })
})
