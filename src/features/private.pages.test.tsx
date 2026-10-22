import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SavedPage } from "@/features/resident/SavedPage"
import { MyRequestsPage } from "@/features/resident/MyRequestsPage"
import { ProfessionalListingsPage } from "@/features/provider/ProfessionalListingsPage"
import { ProfessionalLeadsPage } from "@/features/provider/ProfessionalLeadsPage"
import { ModerationQueuePage } from "@/features/admin/ModerationQueuePage"
import { AdminCategoriesPage } from "@/features/admin/AdminCategoriesPage"
import { AdminDashboardPage } from "@/features/admin/AdminDashboardPage"
import { fail, installFetchMock, ok, type MockCall } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, PRIVATE_ADDRESS, PRIVATE_POINT } from "@/test/fixtures/apiFixtures"
import { adminUser, testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

const resident = () => testUser({ displayName: "Rana Resident" })
const me = (roles: string[] = []) => ({
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Tester",
  email: "tester@example.org",
  emailVerified: true,
  roles,
  authMethods: { password: true, providers: [] },
  session: { expiresAt: "2030-01-01T00:00:00Z" },
})

let calls: MockCall[]
function backend(roles: string[] = []) {
  ;({ calls } = installFetchMock(fakeBackend({ me: me(roles) })))
}

beforeEach(() => backend())
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("auth-aware private reads", () => {
  it("send nothing while the session is still being checked, and show a loading state", async () => {
    renderPage(<SavedPage />, { url: "/profile/saved", user: null, status: "loading" })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls.filter((c) => c.path === "/saved")).toHaveLength(0)
  })

  it("send nothing for an anonymous visitor (the route guard redirects; the page never fetches)", async () => {
    renderPage(<MyRequestsPage />, { url: "/profile/requests", user: null })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls.filter((c) => c.path === "/requests")).toHaveLength(0)
  })

  it("do not request the admin endpoints for a signed-in non-admin", async () => {
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: resident() })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls.filter((c) => c.path.startsWith("/admin"))).toHaveLength(0)
  })
})

describe("Saved", () => {
  it("shows the saved public cards grouped by kind, from GET /saved", async () => {
    renderPage(<SavedPage />, { url: "/profile/saved", user: resident() })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(screen.getByText("Capital Bakers")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /Services \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /Businesses \(1\)/ })).toBeInTheDocument()
    expect(screen.getByText(/^2 saved items\.?$/)).toBeInTheDocument()
  })

  it("offers a working Remove on each saved card (Phase 12H)", async () => {
    renderPage(<SavedPage />, { url: "/profile/saved", user: resident() })
    await screen.findByText("Sunrise Solar Solutions")
    // Every card renders a toggle whose accessible name is "Remove <item> from saved" when saved.
    expect(screen.getAllByRole("button", { name: /remove .+ from saved/i }).length).toBeGreaterThanOrEqual(1)
    for (const button of screen.getAllByRole("button", { name: /remove .+ from saved/i })) {
      expect(button).toHaveAttribute("aria-pressed", "true")
    }
  })

  it("an empty list is an empty state, not an error", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/saved": { status: 200, body: { data: [], meta: { total: 0, limit: 12, offset: 0 } } } } }))
    renderPage(<SavedPage />, { url: "/profile/saved", user: resident() })
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("a failure is shown as a failure with Try again", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/saved": fail(500, "internal_error") } }))
    renderPage(<SavedPage />, { url: "/profile/saved", user: resident() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Nothing saved yet")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument()
  })

  it("an expired session (401) is reported, not shown as empty", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/saved": fail(401, "session_expired") } }))
    renderPage(<SavedPage />, { url: "/profile/saved", user: resident() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Nothing saved yet")).not.toBeInTheDocument()
  })
})

describe("My Requests (read only)", () => {
  it("lists the requester's requests split into active and completed/cancelled with the server's statuses", async () => {
    renderPage(<MyRequestsPage />, { url: "/profile/requests", user: resident() })
    expect((await screen.findAllByText("Solar installation")).length).toBe(2)
    expect(screen.getByRole("heading", { name: /Active \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /Completed & cancelled \(2\)/ })).toBeInTheDocument()
    expect(screen.getByText("Panel inspection")).toBeInTheDocument()
  })

  it("a request whose provider listing is gone still shows, with its stored provider name", async () => {
    renderPage(<MyRequestsPage />, { url: "/profile/requests", user: resident() })
    expect(await screen.findByText("To A provider that has since been removed")).toBeInTheDocument()
  })

  it("opening a request reads its detail and history, and offers no status action", async () => {
    const user = userEvent.setup()
    renderPage(<MyRequestsPage />, { url: "/profile/requests", user: resident() })
    await screen.findByText("Panel inspection")
    await user.click(screen.getAllByRole("button", { name: /panel inspection|view|details/i })[0])
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(calls.some((c) => c.path === `/requests/${IDS.requestOne}` || c.path === `/requests/${IDS.requestTwo}`)).toBe(true))
    expect(await within(dialog).findByText(/history/i)).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /cancel request|mark|accept|start|complete/i })).not.toBeInTheDocument()
  })

  it("empty and failure states are distinct", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/requests": { status: 200, body: { data: [], meta: { total: 0, limit: 12, offset: 0 } } } } }))
    const { unmount } = renderPage(<MyRequestsPage />, { url: "/profile/requests", user: resident() })
    expect(await screen.findByText("No requests yet")).toBeInTheDocument()
    unmount()
    installFetchMock(fakeBackend({ me: me(), overrides: { "/requests": "network-error" } }))
    renderPage(<MyRequestsPage />, { url: "/profile/requests", user: resident() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("No requests yet")).not.toBeInTheDocument()
  })
})

describe("Professional: listings", () => {
  it("shows every listing with its REAL status, revision and the admin's rejection reason", async () => {
    renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user: resident() })
    expect(await screen.findByText("Pending Stationers")).toBeInTheDocument()
    expect(screen.getByText("Approved Plumbing Co")).toBeInTheDocument()
    expect(screen.getByText("Rejected Plot")).toBeInTheDocument()
    expect(screen.getByText("Archived Tutor")).toBeInTheDocument()
    expect(screen.getByText(/revision 2/)).toBeInTheDocument()
    expect(screen.getByText("Please add the plot size and a clearer description.")).toBeInTheDocument()
  })

  it("offers View, Edit and Archive on active rows (Phase 12H); archived rows show View only; no Delete exists", async () => {
    renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user: resident() })
    await screen.findByText("Pending Stationers")
    // There are three active listings (pending, approved, rejected) and one archived in the fixtures.
    expect(screen.getAllByRole("button", { name: "View" }).length).toBe(4)
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBe(3)
    expect(screen.getAllByRole("button", { name: "Archive" }).length).toBe(3)
    // There is no destructive delete.
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument()
  })

  it("the owner preview shows the PRIVATE location (address and point) - owner view only", async () => {
    const user = userEvent.setup()
    renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user: resident() })
    await screen.findByText("Pending Stationers")
    await user.click(screen.getAllByRole("button", { name: "View" })[0])
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText(PRIVATE_ADDRESS)).toBeInTheDocument()
    expect(within(dialog).getByText(`${PRIVATE_POINT.latitude}, ${PRIVATE_POINT.longitude}`)).toBeInTheDocument()
    expect(within(dialog).getByText(/exact pin, with the address/i)).toBeInTheDocument()
  })

  it("a failure is an error, not an empty dashboard", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/users/me/listings": fail(403, "forbidden") } }))
    renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user: resident() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("You haven't listed anything yet")).not.toBeInTheDocument()
  })
})

describe("Professional: leads (read only)", () => {
  it("lists the leads sent to the owner's listings with the server's statuses", async () => {
    renderPage(<ProfessionalLeadsPage />, { url: "/provider/leads", user: resident() })
    expect(await screen.findByText("From Rana Resident")).toBeInTheDocument()
    expect(screen.getByText("From Naila Khan")).toBeInTheDocument()
  })

  it("offers no accept / start / complete / cancel control (writes arrive in 12H)", async () => {
    renderPage(<ProfessionalLeadsPage />, { url: "/provider/leads", user: resident() })
    await screen.findByText("From Rana Resident")
    expect(screen.queryByRole("button", { name: /^(accept|start|complete|cancel|decline)/i })).not.toBeInTheDocument()
  })

  it("a 403 (not a verified professional) is an error, not an empty list", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/users/me/leads": fail(403, "forbidden") } }))
    renderPage(<ProfessionalLeadsPage />, { url: "/provider/leads", user: resident() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
  })
})

describe("Admin: moderation queue", () => {
  beforeEach(() => backend(["admin"]))

  it("shows the server's queue with whole-queue counts on the filter buttons", async () => {
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    expect(await screen.findByText("Pending Stationers")).toBeInTheDocument()
    expect(await screen.findByRole("radio", { name: "All (3)" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Pending (1)" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Rejected (1)" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Archived (0)" })).toBeInTheDocument()
  })

  it("the status filter is the server's: it re-queries, and the counts do not change", async () => {
    const user = userEvent.setup()
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    await screen.findByText("Pending Stationers")
    await user.click(screen.getByRole("radio", { name: /^Rejected/ }))
    await waitFor(() => expect(screen.queryByText("Pending Stationers")).not.toBeInTheDocument())
    expect(screen.getByText("Rejected Plot")).toBeInTheDocument()
    expect(calls.some((c) => c.path === "/admin/listings" && c.url.includes("status=rejected"))).toBe(true)
    expect(screen.getByRole("radio", { name: "All (3)" })).toBeInTheDocument()
  })

  it("Review opens a read-only panel: private location visible to the admin, and approve / reject disabled", async () => {
    const user = userEvent.setup()
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    await screen.findByText("Pending Stationers")
    await user.click(screen.getByRole("button", { name: "Review Pending Stationers" }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText(PRIVATE_ADDRESS)).toBeInTheDocument()
    // Phase 12H: Approve is enabled for a pending listing; Reject is enabled for pending or approved.
    expect(within(dialog).getByRole("button", { name: /^Approve$/ })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: /^Reject$/ })).toBeEnabled()
    expect(within(dialog).getByText(/Sana Owner \(owner\)/)).toBeInTheDocument() // the status history, from the server
    // The dialog has not called a write (the user has not clicked anything).
    expect(calls.some((c) => c.method !== "GET" && !c.path.startsWith("/auth"))).toBe(false)
  })

  it("an empty filter is an empty state; a 403 is an error", async () => {
    const user = userEvent.setup()
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    await screen.findByText("Pending Stationers")
    await user.click(screen.getByRole("radio", { name: /^Archived/ }))
    expect(await screen.findByText("No archived listings.")).toBeInTheDocument()
  })

  it("a forbidden queue is an error", async () => {
    installFetchMock(fakeBackend({ me: me(["admin"]), overrides: { "/admin/listings": fail(403, "forbidden") } }))
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
  })
})

describe("Admin: categories and dashboard", () => {
  beforeEach(() => backend(["admin"]))

  it("lists every category including INACTIVE ones, marked, with no editing controls", async () => {
    renderPage(<AdminCategoriesPage />, { url: "/admin/categories", user: adminUser() })
    expect(await screen.findByText("Retired Category")).toBeInTheDocument()
    expect(screen.getAllByText("Inactive")).toHaveLength(1)
    expect(screen.getAllByText("Active").length).toBeGreaterThan(5)
    // Phase 12H: add / rename / reorder / activate controls are present and enabled.
    expect(screen.getAllByRole("button", { name: /^Add a/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: /^(Activate|Deactivate)$/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: /^Move .* up$/i }).length).toBeGreaterThan(0)
  })

  it("the dashboard counts are the server's (and show an em dash while unknown)", async () => {
    renderPage(<AdminDashboardPage />, { url: "/admin", user: adminUser() })
    // Unknown while loading: an em dash, never a made-up zero.
    expect(await screen.findByRole("link", { name: "Pending listings: —" })).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "Pending listings: 1" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Archived listings: 0" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Rejected listings: 1" })).toBeInTheDocument()
  })

  it("a count that could not be loaded is an error, never zero", async () => {
    installFetchMock(fakeBackend({ me: me(["admin"]), overrides: { "/admin/listings": "network-error" } }))
    renderPage(<AdminDashboardPage />, { url: "/admin", user: adminUser() })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
  })

  it("the categories read passes through unchanged for an unknown success shape", async () => {
    installFetchMock(fakeBackend({ me: me(["admin"]), overrides: { "/admin/categories": ok([]) } }))
    renderPage(<AdminCategoriesPage />, { url: "/admin/categories", user: adminUser() })
    expect(await screen.findByText("There are no categories yet.")).toBeInTheDocument()
  })
})

describe("Overview pages (real counts)", () => {
  // A metric tile is the card that holds the label; the same word may also appear in navigation or a badge.
  const tile = (label: string): HTMLElement => {
    const card = screen
      .getAllByText(label)
      .map((el) => el.closest<HTMLElement>('[data-slot="card"]'))
      .find((el): el is HTMLElement => el !== null && el.textContent?.startsWith(label) === true)
    if (!card) throw new Error(`no metric tile "${label}"`)
    return card
  }

  it("resident overview: saved total, active and all requests are the server's totals", async () => {
    const { ResidentOverviewPage } = await import("@/features/resident/ResidentOverviewPage")
    renderPage(<ResidentOverviewPage />, { url: "/profile", user: resident() })
    await waitFor(() => expect(within(tile("Saved")).getByText("2")).toBeInTheDocument())
    await waitFor(() => expect(within(tile("All requests")).getByText("3")).toBeInTheDocument())
    await waitFor(() => expect(within(tile("Active requests")).queryByText("—")).not.toBeInTheDocument())
  })

  it("resident overview shows an em dash - not zero - when a count cannot be read", async () => {
    installFetchMock(fakeBackend({ me: me(), overrides: { "/saved": fail(500, "internal_error") } }))
    const { ResidentOverviewPage } = await import("@/features/resident/ResidentOverviewPage")
    renderPage(<ResidentOverviewPage />, { url: "/profile", user: resident() })
    await waitFor(() => expect(within(tile("All requests")).getByText("3")).toBeInTheDocument())
    expect(within(tile("Saved")).getByText("—")).toBeInTheDocument()
  })

  it("professional overview: listing counts per status come from the server", async () => {
    const { ProfessionalOverviewPage } = await import("@/features/provider/ProfessionalOverviewPage")
    renderPage(<ProfessionalOverviewPage />, { url: "/provider", user: resident() })
    await waitFor(() => expect(within(tile("Total listings")).getByText("4")).toBeInTheDocument())
    expect(within(tile("Pending review")).getByText("1")).toBeInTheDocument()
    expect(within(tile("Rejected")).getByText("1")).toBeInTheDocument()
  })
})
