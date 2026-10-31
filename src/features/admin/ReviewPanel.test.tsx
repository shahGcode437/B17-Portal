import { useEffect, useState } from "react"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReviewPanel } from "@/features/admin/ReviewPanel"
import { toAdminListing } from "@/lib/api/ownerAdapters"
import type { AdminHistoryEntryDto, AdminListingDto } from "@/lib/api/dto/private"
import { fail, installFetchMock, meBody, ok } from "@/test/apiMock"
import { fakeBackend, type FakeBackendOptions } from "@/test/fixtures/fakeBackend"
import { PRIVATE_ADDRESS, PRIVATE_POINT } from "@/test/fixtures/apiFixtures"
import { adminUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"
import type { AdminQueueRow } from "@/types/ownerListing"

/**
 * The review dialog (S5A): a moderator sees the facts they are judging for every kind of listing (B-01), and a
 * takedown reads as a takedown, not as a rejection (B-03). The dialog reads `GET /admin/listings/{id}`; each test
 * serves one listing shaped like the real admin API (the shared fake backend is read-only).
 */
afterEach(() => vi.unstubAllGlobals())

const ref = (slug: string, name: string) => ({ slug, name, isPrimary: true })
const submitted: AdminHistoryEntryDto = {
  action: "submitted",
  toStatus: "pending",
  revision: 1,
  actor: { displayName: "Sana Owner", role: "owner" },
  createdAt: "2026-10-05T08:00:00Z",
}

const base = {
  area: "B-17",
  tags: [] as string[],
  status: "pending",
  revision: 1,
  description: "Described by the owner.",
  location: { visibility: "exact", block: "C", address: PRIVATE_ADDRESS, ...PRIVATE_POINT },
  publicLocation: { visibility: "approximate", block: "C" },
  submittedAt: "2026-10-05T08:00:00Z",
  createdAt: "2026-10-05T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
  submitter: { displayName: "Sana Owner" },
  history: [submitted],
}

const PROVIDER = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000a1",
  kind: "provider",
  name: "Imran Electrical Works",
  category: "electrical",
  categoryLabel: "Electrical",
  categories: [ref("electrical", "Electrical")],
  tags: ["wiring", "repairs", "inverter fitting"],
} as AdminListingDto

const FOOD = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000a2",
  kind: "business",
  vertical: "food",
  name: "Kabab Corner",
  categoryLabel: "Restaurants",
  categories: [ref("restaurants", "Restaurants")],
  tags: ["biryani", "karahi"],
  food: {
    categories: ["restaurants", "fast-food"],
    serviceOptions: ["dine-in", "takeaway", "delivery"],
    hoursNote: "Mon-Sun, 12 PM to 11 PM",
    menuHighlights: [
      { id: "m1", name: "Chicken Karahi", section: "Mains", price: "PKR 1,800" },
      { id: "m2", name: "Seekh Kabab", price: "PKR 600" },
    ],
    menuImage: "/images/food/menu.jpg",
  },
} as AdminListingDto

const TUTOR = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000a3",
  kind: "tutor",
  name: "Ms Hina Tariq",
  category: "physics",
  categoryLabel: "Physics",
  categories: [ref("physics", "Physics")],
  grade: "Grade 9",
  tags: ["matric physics", "o-level"],
} as AdminListingDto

const PROPERTY = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000a4",
  kind: "property",
  title: "Corner House, Block C",
  listingType: "sale",
  propertyType: "house",
  categoryLabel: "House",
  categories: [ref("house", "House")],
  price: "PKR 2.5 Cr",
  bedrooms: 4,
  furnished: "Semi-Furnished",
} as AdminListingDto

function rowOf(dto: AdminListingDto): AdminQueueRow {
  const view = toAdminListing(dto)
  return {
    id: view.id,
    kind: view.kind,
    ...(view.vertical ? { vertical: view.vertical } : {}),
    title: view.title,
    typeLabel: view.typeLabel,
    categoryLabel: view.categoryLabel,
    area: view.area,
    locationVisibility: view.location.visibility,
    status: view.status,
    revision: view.revision,
    submittedAt: view.submittedAt,
  }
}

function review(dto: AdminListingDto) {
  installFetchMock(
    fakeBackend({ me: meBody({ roles: ["admin"] }), overrides: { [`/admin/listings/${dto.id}`]: ok(dto) } })
  )
  renderPage(<ReviewPanel row={rowOf(dto)} open onOpenChange={vi.fn()} />, { url: "/admin/moderation", user: adminUser() })
  return screen.findByRole("dialog")
}

/** A fact list as `{ label: value }`, read from the <dt>/<dd> pairs of one region. */
function factsOf(region: HTMLElement): Record<string, string | null | undefined> {
  return Object.fromEntries(Array.from(region.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]))
}

describe("B-01: the review shows the facts a moderator judges, for every kind", () => {
  it("a service provider: the services offered", async () => {
    const dialog = await review(PROVIDER)
    const services = await within(dialog).findByRole("region", { name: "Services offered" })
    for (const tag of ["wiring", "repairs", "inverter fitting"]) expect(within(services).getByText(tag)).toBeInTheDocument()
    expect(within(dialog).queryByRole("region", { name: "Listing details" })).not.toBeInTheDocument()
  })

  it("a Food & Dining business: categories, services, hours, menu highlights, and the dishes", async () => {
    const dialog = await review(FOOD)
    const food = await within(dialog).findByRole("region", { name: /Food & Dining details/ })
    const facts = factsOf(food)
    expect(facts["Categories"]).toContain("Restaurants")
    expect(facts["Categories"]).toContain("(primary)")
    expect(facts["Services"]).toBe("Dine-in, Takeaway, Delivery by the business")
    expect(facts["Hours"]).toBe("Mon-Sun, 12 PM to 11 PM")
    expect(facts["Menu highlights"]).toContain("2 items")
    expect(facts["Menu highlights"]).toContain("Chicken Karahi")
    expect(facts["Menu highlights"]).toContain("PKR 1,800")
    expect(facts["Menu image"]).toBe("Added")
    const dishes = within(dialog).getByRole("region", { name: "Dishes and search tags" })
    expect(within(dishes).getByText("biryani")).toBeInTheDocument()
  })

  it("a tutor: the subject and the grade, and the topics taught", async () => {
    const dialog = await review(TUTOR)
    const details = await within(dialog).findByRole("region", { name: "Listing details" })
    expect(factsOf(details)).toEqual({ Subject: "Physics", "Grade / level": "Grade 9" })
    const topics = within(dialog).getByRole("region", { name: "Topics taught" })
    expect(within(topics).getByText("matric physics")).toBeInTheDocument()
  })

  it("a property: sale or rent, type, price, bedrooms and furnishing, with the area and block", async () => {
    const dialog = await review(PROPERTY)
    const details = await within(dialog).findByRole("region", { name: "Listing details" })
    expect(factsOf(details)).toEqual({
      Listing: "For Sale",
      "Property type": "House",
      Price: "PKR 2.5 Cr",
      Bedrooms: "4",
      Furnishing: "Semi-Furnished",
    })
    // The facts block carries no location detail: the address and the stored point stay in the Location block.
    expect(details).not.toHaveTextContent(PRIVATE_ADDRESS)
    expect(details).not.toHaveTextContent(String(PRIVATE_POINT.latitude))
    const location = within(dialog).getByRole("region", { name: "Location" })
    expect(factsOf(location)).toMatchObject({ Area: "B-17", Block: "C" })
  })

  it("a property for rent says For Rent", async () => {
    const dialog = await review({ ...PROPERTY, listingType: "rent" } as AdminListingDto)
    const details = await within(dialog).findByRole("region", { name: "Listing details" })
    expect(factsOf(details).Listing).toBe("For Rent")
  })
})

describe("B-03: a takedown is not a rejection", () => {
  const takenDownHistory: AdminHistoryEntryDto[] = [
    submitted,
    {
      action: "approved",
      fromStatus: "pending",
      toStatus: "approved",
      revision: 1,
      actor: { displayName: "Site Admin", role: "admin" },
      createdAt: "2026-10-06T08:00:00Z",
    },
    {
      action: "rejected",
      fromStatus: "approved",
      toStatus: "rejected",
      revision: 1,
      reason: "Reported as closed; please confirm you still trade.",
      actor: { displayName: "Site Admin", role: "admin" },
      createdAt: "2026-10-07T08:00:00Z",
    },
  ]

  it("a taken-down listing is labelled Taken down, with a takedown reason and a Taken down history row", async () => {
    const dialog = await review({
      ...PROVIDER,
      status: "rejected",
      takenDown: true,
      rejectionReason: "Reported as closed; please confirm you still trade.",
      history: takenDownHistory,
    } as AdminListingDto)
    expect(await within(dialog).findByText("Takedown reason")).toBeInTheDocument()
    // The status cell says Taken down (not Rejected).
    expect(factsOf(dialog.querySelector("dl") as HTMLElement).Status).toBe("Taken down")
    const history = within(dialog).getByRole("region", { name: "History" })
    expect(within(history).getByText("Taken down")).toBeInTheDocument()
    expect(within(history).getByText("approved")).toBeInTheDocument()
    expect(within(history).queryByText("rejected")).not.toBeInTheDocument()
    expect(within(dialog).queryByText("Rejection reason")).not.toBeInTheDocument()
  })

  it("a listing refused while pending stays Rejected, with a rejection reason and a rejected history row", async () => {
    const dialog = await review({
      ...PROVIDER,
      status: "rejected",
      rejectionReason: "Please add a clearer description.",
      history: [
        submitted,
        {
          action: "rejected",
          fromStatus: "pending",
          toStatus: "rejected",
          revision: 1,
          reason: "Please add a clearer description.",
          actor: { displayName: "Site Admin", role: "admin" },
          createdAt: "2026-10-06T08:00:00Z",
        },
      ],
    } as AdminListingDto)
    expect(await within(dialog).findByText("Rejection reason")).toBeInTheDocument()
    expect(factsOf(dialog.querySelector("dl") as HTMLElement).Status).toBe("Rejected")
    const history = within(dialog).getByRole("region", { name: "History" })
    expect(within(history).getByText("rejected")).toBeInTheDocument()
    expect(within(history).queryByText("Taken down")).not.toBeInTheDocument()
    expect(within(dialog).queryByText("Takedown reason")).not.toBeInTheDocument()
  })
})

/**
 * A decision in progress belongs to ONE opening of the dialog for ONE listing (S5A closeout). The panel stays mounted
 * between listings, so rejecting A used to leave A's open reject form, its text and its error on B. These tests drive
 * the panel the way the queue does: one panel, a changing row, and a dialog that closes and opens again.
 */
describe("a half-made decision never follows the reviewer to another listing", () => {
  const A = PROVIDER
  const B = FOOD
  const REASON = "Please add your opening hours and a clearer description."

  interface Control {
    show: (index: number) => void
  }

  // The harness hands the test a way to change the reviewed row; it lives outside the component so the effect does not
  // mutate a prop.
  const control: { current: Control | null } = { current: null }

  function Harness() {
    const [index, setIndex] = useState(0)
    const [open, setOpen] = useState(true)
    useEffect(() => {
      control.current = {
        show: (next) => {
          setIndex(next)
          setOpen(true)
        },
      }
    })
    return <ReviewPanel row={[rowOf(A), rowOf(B)][index] ?? null} open={open} onOpenChange={setOpen} />
  }

  function openPanel(overrides: NonNullable<FakeBackendOptions["overrides"]> = {}) {
    installFetchMock(
      fakeBackend({
        me: meBody({ roles: ["admin"] }),
        overrides: { [`/admin/listings/${A.id}`]: ok(A), [`/admin/listings/${B.id}`]: ok(B), ...overrides },
      })
    )
    control.current = null
    renderPage(<Harness />, { url: "/admin/moderation", user: adminUser() })
    return { control, user: userEvent.setup() }
  }

  const dialogOf = () => screen.findByRole("dialog", { name: "Review Listing" })
  const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

  async function expectCleanDecision(dialog: HTMLElement) {
    // The two decision buttons, and none of the reject form (or anything typed into it).
    expect(await within(dialog).findByRole("button", { name: /^Reject$/ })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: /^Approve$/ })).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Rejection reason|Take down reason/)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Confirm Rejection|Confirm takedown/ })).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(REASON)
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  }

  it("after A is rejected, the dialog for B opens on the decision buttons, with no reason text", async () => {
    const { control, user } = openPanel({ [`POST /admin/listings/${A.id}/reject`]: ok({ ...A, status: "rejected", rejectionReason: REASON }) })
    let dialog = await dialogOf()
    await user.click(await within(dialog).findByRole("button", { name: /^Reject$/ }))
    await user.type(within(dialog).getByLabelText(/Rejection reason/), REASON)
    await user.click(within(dialog).getByRole("button", { name: /Confirm Rejection/ }))
    await closed() // a successful decision closes the dialog

    act(() => control.current?.show(1))
    dialog = await dialogOf()
    expect(dialog).toHaveTextContent("Kabab Corner")
    await expectCleanDecision(dialog)
  })

  it("an abandoned reject form is gone when the SAME listing is opened again", async () => {
    const { control, user } = openPanel()
    let dialog = await dialogOf()
    await user.click(await within(dialog).findByRole("button", { name: /^Reject$/ }))
    await user.type(within(dialog).getByLabelText(/Rejection reason/), REASON)
    await user.keyboard("{Escape}") // closes without deciding
    await closed()

    act(() => control.current?.show(0))
    dialog = await dialogOf()
    await expectCleanDecision(dialog)
  })

  it("changing the reviewed listing while the dialog is open resets it too", async () => {
    const { control, user } = openPanel()
    const dialog = await dialogOf()
    await user.click(await within(dialog).findByRole("button", { name: /^Reject$/ }))
    await user.type(within(dialog).getByLabelText(/Rejection reason/), REASON)

    act(() => control.current?.show(1))
    await waitFor(() => expect(dialog).toHaveTextContent("Kabab Corner"))
    await expectCleanDecision(dialog)
  })

  it("a refused decision on A does not leave its error on B", async () => {
    const { control, user } = openPanel({ [`POST /admin/listings/${A.id}/approve`]: fail(409, "listing_conflict", [{ field: "revision", code: "stale_revision" }]) })
    let dialog = await dialogOf()
    await user.click(await within(dialog).findByRole("button", { name: /^Approve$/ }))
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument() // the refusal is shown on A
    await user.keyboard("{Escape}")
    await closed()

    act(() => control.current?.show(1))
    dialog = await dialogOf()
    await expectCleanDecision(dialog)
  })

  it("a takedown form is reset the same way (an approved listing says Take down, then starts clean on the next one)", async () => {
    const live = { ...A, status: "approved" } as AdminListingDto
    installFetchMock(
      fakeBackend({
        me: meBody({ roles: ["admin"] }),
        overrides: { [`/admin/listings/${live.id}`]: ok(live), [`/admin/listings/${B.id}`]: ok(B) },
      })
    )
    control.current = null
    function TakedownHarness() {
      const [index, setIndex] = useState(0)
      const [open, setOpen] = useState(true)
      useEffect(() => {
        control.current = { show: (next) => (setIndex(next), setOpen(true)) }
      })
      return <ReviewPanel row={[rowOf(live), rowOf(B)][index] ?? null} open={open} onOpenChange={setOpen} />
    }
    renderPage(<TakedownHarness />, { url: "/admin/moderation", user: adminUser() })
    const user = userEvent.setup()
    let dialog = await dialogOf()
    await user.click(await within(dialog).findByRole("button", { name: /^Take down$/ }))
    await user.type(within(dialog).getByLabelText(/Take down reason/), REASON)
    await user.keyboard("{Escape}")
    await closed()

    act(() => control.current?.show(1))
    dialog = await dialogOf()
    await expectCleanDecision(dialog)
  })
})
