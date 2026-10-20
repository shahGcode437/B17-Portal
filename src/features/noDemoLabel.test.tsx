import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BusinessProfilePage } from "@/features/directory/BusinessProfilePage"
import { TutorProfilePage } from "@/features/education/TutorProfilePage"
import { PropertyDetailsPage } from "@/features/property/PropertyDetailsPage"
import { ProviderProfilePage } from "@/features/services/ProviderProfilePage"
import { NewsArticlePage } from "@/features/news/NewsArticlePage"
import { SearchPage } from "@/features/search/SearchPage"
import { SavedPage } from "@/features/resident/SavedPage"
import { ProfessionalListingsPage } from "@/features/provider/ProfessionalListingsPage"
import { ModerationQueuePage } from "@/features/admin/ModerationQueuePage"
import { resetCategoryCache } from "@/hooks/useCategories"
import { installFetchMock } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS } from "@/test/fixtures/apiFixtures"
import { adminUser, testUser } from "@/test/authFixtures"
import { renderPage } from "@/test/renderPage"

/**
 * O-4 (Phase 12G review): a listing that comes from the real API is never labelled "Demo" - the
 * frontend has no authority to say so (the API exposes no demo / seed flag), and it must not infer
 * it from an id, a title or the environment. These tests render real-API listings on every surface
 * that used to carry the badge or a "prototype / demo details" notice.
 */
const DEMO_COPY = /demo listing|demo preview|demo details|prototype (listing|business|tutor|property|content)|does not represent a real|not a real b-17/i

const me = (roles: string[] = []) => ({
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Tester",
  email: "tester@example.org",
  emailVerified: true,
  roles,
  authMethods: { password: true, providers: [] },
  session: { expiresAt: "2030-01-01T00:00:00Z" },
})

vi.mock("@/components/location/leafletEngine", () => ({
  leafletEngine: { mount: () => ({ destroy: () => undefined }) },
}))

beforeEach(() => {
  resetCategoryCache()
  installFetchMock(fakeBackend({ me: me(["admin"]) }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("real API listings carry no Demo label", () => {
  it.each([
    ["provider detail", <ProviderProfilePage key="p" />, `/providers/${IDS.provider}`, "/providers/:id", "Sunrise Solar Solutions"],
    ["general business detail", <BusinessProfilePage key="b" />, `/businesses/${IDS.generalExact}`, "/businesses/:id", "Glow Salon"],
    ["Food business detail", <BusinessProfilePage key="f" />, `/businesses/${IDS.foodExact}`, "/businesses/:id", "Capital Bakers"],
    ["tutor detail", <TutorProfilePage key="t" />, `/tutors/${IDS.tutorApproximate}`, "/tutors/:id", "Sara M."],
    ["property detail", <PropertyDetailsPage key="r" />, `/properties/${IDS.propertyExact}`, "/properties/:id", "5 Marla House - B-17 Block C"],
  ])("%s", async (_name, page, url, path, heading) => {
    renderPage(page, { url, path, user: null })
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
    expect(screen.queryByText(/^demo$/i)).not.toBeInTheDocument()
  })

  it("news article", async () => {
    renderPage(<NewsArticlePage />, { url: `/news/${IDS.news}`, path: "/news/:id", user: null })
    await screen.findByRole("heading", { level: 1 })
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
  })

  it("every kind of search card, and the quick look", async () => {
    const user = userEvent.setup()
    renderPage(<SearchPage />, { url: "/search", path: "/search", user: null })
    expect(await screen.findByRole("button", { name: "Preview Capital Bakers" })).toBeInTheDocument()
    for (const name of ["Preview Sunrise Solar Solutions", "Preview Sara M.", "Preview 5 Marla House - B-17 Block C"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Preview Capital Bakers" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
  })

  it("Saved cards", async () => {
    renderPage(<SavedPage />, { url: "/profile/saved", user: testUser() })
    expect(await screen.findByText("Sunrise Solar Solutions")).toBeInTheDocument()
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
  })

  it("owner listings and the admin queue", async () => {
    const { unmount } = renderPage(<ProfessionalListingsPage />, { url: "/provider/listings", user: testUser() })
    expect(await screen.findByText("Pending Stationers")).toBeInTheDocument()
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
    unmount()
    renderPage(<ModerationQueuePage />, { url: "/admin/moderation", user: adminUser() })
    await waitFor(() => expect(screen.getByText("Pending Stationers")).toBeInTheDocument())
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
  })

  it("is judged on the id and title too: an id or name that looks like a fixture changes nothing", async () => {
    // The fixtures' ids are all-zero UUIDs and several names say "Demo"; the badge must not appear for that reason either.
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalAreaOnly}`, path: "/businesses/:id", user: null })
    await screen.findByRole("heading", { level: 1, name: "B-17 Family Pharmacy" })
    expect(screen.queryByText(DEMO_COPY)).not.toBeInTheDocument()
  })
})
