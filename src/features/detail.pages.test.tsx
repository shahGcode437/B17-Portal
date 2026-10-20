import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BusinessProfilePage } from "@/features/directory/BusinessProfilePage"
import { TutorProfilePage } from "@/features/education/TutorProfilePage"
import { PropertyDetailsPage } from "@/features/property/PropertyDetailsPage"
import { ProviderProfilePage } from "@/features/services/ProviderProfilePage"
import type { MapViewOptions } from "@/components/location/mapEngine"
import { installFetchMock, fail } from "@/test/apiMock"
import { fakeBackend } from "@/test/fixtures/fakeBackend"
import { IDS, PRIVATE_ADDRESS, PRIVATE_POINT } from "@/test/fixtures/apiFixtures"
import { renderPage } from "@/test/renderPage"

// The real Leaflet engine is covered by its own smoke test; here the page-level contract is what the
// engine is asked to draw, so a recording engine stands in (no tiles, no canvas, no network).
const mounts = vi.hoisted(() => [] as unknown[])
vi.mock("@/components/location/leafletEngine", () => ({
  leafletEngine: {
    mount: (_element: HTMLElement, options: unknown) => {
      mounts.push(options)
      return { destroy: () => undefined }
    },
  },
}))

const drawn = () => mounts as MapViewOptions[]

beforeEach(() => {
  mounts.length = 0
  installFetchMock(fakeBackend())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Business detail (general)", () => {
  it("shows the content from the API with an exact pin, directions and address text", async () => {
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalExact}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Glow Salon" })).toBeInTheDocument()
    expect(screen.getByText("Hairdressing")).toBeInTheDocument()
    expect(screen.getByText("Shop 9, Salon Row")).toBeInTheDocument()
    expect(screen.getByText("Next to the bank")).toBeInTheDocument()
    const map = await screen.findByTestId("location-map")
    expect(map).toHaveAttribute("data-map-mode", "exact")
    await waitFor(() => expect(drawn()).toHaveLength(1))
    expect(drawn()[0].marker?.position).toEqual({ latitude: 33.70789, longitude: 73.052109 })
    const directions = screen.getByRole("link", { name: /get directions/i })
    expect(directions).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=33.70789%2C73.052109")
    // A General business has no Food sections.
    expect(screen.queryByText(/menu/i)).not.toBeInTheDocument()
  })

  it("area-only: text only - no map, no Leaflet instance, no directions", async () => {
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalAreaOnly}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "B-17 Family Pharmacy" })).toBeInTheDocument()
    expect(screen.getByText("Location shared at area level.")).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
    expect(drawn()).toHaveLength(0)
  })

  it("renders not-found for an id the API does not know (404), with a way back", async () => {
    const user = userEvent.setup()
    renderPage(<BusinessProfilePage />, { url: "/businesses/nope", path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Business not found" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Back to Directory" }))
    expect(screen.getByTestId("location")).toHaveTextContent("/directory")
  })

  it("treats a listing of another kind as not found (a tutor id on the business page)", async () => {
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.tutorApproximate}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Business not found" })).toBeInTheDocument()
  })

  it("shows a retryable error - not content, not 'not found' - when the server fails, and recovers", async () => {
    let healthy = false
    installFetchMock((call) => (healthy ? fakeBackend()(call) : fail(500, "internal_error")))
    const user = userEvent.setup()
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalExact}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Business not found")).not.toBeInTheDocument()
    expect(screen.queryByText("Glow Salon")).not.toBeInTheDocument()
    healthy = true
    await user.click(screen.getByRole("button", { name: /try again|retry/i }))
    expect(await screen.findByRole("heading", { level: 1, name: "Glow Salon" })).toBeInTheDocument()
  })

  it("shows a network failure as a failure (no demo fallback)", async () => {
    installFetchMock(() => "network-error")
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalExact}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 1, name: "Glow Salon" })).not.toBeInTheDocument()
  })

  it("shows a loading state first", () => {
    installFetchMock(() => new Promise(() => {}) as never)
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalExact}`, path: "/businesses/:id", user: null })
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })
})

describe("Business detail (Food & Dining)", () => {
  it("is the same page: vertical badge, server category names, hours, menu and an exact pin", async () => {
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.foodExact}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Capital Bakers" })).toBeInTheDocument()
    expect(screen.getByText("Food & Dining")).toBeInTheDocument()
    expect(screen.getByText("Sweets / Desserts")).toBeInTheDocument() // "Also serves", from the server's category names
    expect(screen.getByText("Daily, 8 AM-10 PM")).toBeInTheDocument()
    expect(screen.getByText("Fresh Milk Bread")).toBeInTheDocument()
    expect(screen.getByText("PKR 1,800")).toBeInTheDocument()
    expect(await screen.findByTestId("location-map")).toHaveAttribute("data-map-mode", "exact")
  })

  it("approximate: labelled approximate, block only, circle - and no address, pin or directions", async () => {
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.foodApproximate}`, path: "/businesses/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Mocha Corner Cafe" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Approximate location" })).toBeInTheDocument()
    expect(await screen.findByTestId("location-map")).toHaveAttribute("data-map-mode", "approximate")
    await waitFor(() => expect(drawn()).toHaveLength(1))
    expect(drawn()[0].marker).toBeUndefined()
    expect(drawn()[0].circle?.center).toEqual({ latitude: 33.71, longitude: 73.06 })
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Address")).not.toBeInTheDocument()
  })
})

describe("Provider detail", () => {
  it("shows the provider, its category name and area-level location only", async () => {
    renderPage(<ProviderProfilePage />, { url: `/providers/${IDS.provider}`, path: "/providers/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Sunrise Solar Solutions" })).toBeInTheDocument()
    expect(screen.getByText("Solar")).toBeInTheDocument()
    expect(screen.getByText("Location shared at area level.")).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
    expect(drawn()).toHaveLength(0)
  })

  it("does not offer a request that cannot be sent yet (writes arrive in 12H)", async () => {
    renderPage(<ProviderProfilePage />, { url: `/providers/${IDS.provider}`, path: "/providers/:id", user: null })
    await screen.findByRole("heading", { level: 1, name: "Sunrise Solar Solutions" })
    const request = screen.getByRole("button", { name: /request service/i })
    expect(request).toBeDisabled()
  })

  it("renders not-found for an unknown id", async () => {
    renderPage(<ProviderProfilePage />, { url: "/providers/nope", path: "/providers/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: /not found/i })).toBeInTheDocument()
  })
})

describe("Tutor detail", () => {
  it("approximate tutor: approximate label, circle, no directions", async () => {
    renderPage(<TutorProfilePage />, { url: `/tutors/${IDS.tutorApproximate}`, path: "/tutors/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Sara M." })).toBeInTheDocument()
    expect(screen.getByText("Physics tutor focused on O/A-level and matric board preparation.")).toBeInTheDocument()
    expect(await screen.findByTestId("location-map")).toHaveAttribute("data-map-mode", "approximate")
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
  })

  it("area-only tutor: no map", async () => {
    renderPage(<TutorProfilePage />, { url: `/tutors/${IDS.tutorAreaOnly}`, path: "/tutors/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "Ali R." })).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
  })

  it("not found", async () => {
    renderPage(<TutorProfilePage />, { url: "/tutors/nope", path: "/tutors/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: /not found/i })).toBeInTheDocument()
  })
})

describe("Property detail", () => {
  it("exact property: facts, address text, pin and directions", async () => {
    renderPage(<PropertyDetailsPage />, { url: `/properties/${IDS.propertyExact}`, path: "/properties/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "5 Marla House - B-17 Block C" })).toBeInTheDocument()
    expect(screen.getByText("PKR 2.2 Cr")).toBeInTheDocument()
    expect(screen.getByText("Plot 12, Street 4")).toBeInTheDocument()
    expect(await screen.findByTestId("location-map")).toHaveAttribute("data-map-mode", "exact")
    expect(screen.getByRole("link", { name: /get directions/i })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=33.703456%2C73.054321"
    )
  })

  it("area-only property: no map and no directions", async () => {
    renderPage(<PropertyDetailsPage />, { url: `/properties/${IDS.propertyAreaOnly}`, path: "/properties/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: "2 Bed Flat for Rent - B-17 Block D" })).toBeInTheDocument()
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /directions/i })).not.toBeInTheDocument()
  })

  it("not found", async () => {
    renderPage(<PropertyDetailsPage />, { url: "/properties/nope", path: "/properties/:id", user: null })
    expect(await screen.findByRole("heading", { level: 1, name: /not found/i })).toBeInTheDocument()
  })
})

describe("no private location ever reaches a public page", () => {
  it("renders none of the owner-only address or point on any public detail", async () => {
    for (const [Page, path, id] of [
      [BusinessProfilePage, "/businesses/:id", IDS.generalExact],
      [PropertyDetailsPage, "/properties/:id", IDS.propertyExact],
      [TutorProfilePage, "/tutors/:id", IDS.tutorApproximate],
    ] as const) {
      const { container, unmount } = renderPage(<Page />, { url: path.replace(":id", id), path, user: null })
      await waitFor(() => expect(within(container).getByRole("heading", { level: 1 })).toBeInTheDocument())
      await screen.findByTestId("location-map")
      const html = container.innerHTML
      expect(html).not.toContain(PRIVATE_ADDRESS)
      expect(html).not.toContain(String(PRIVATE_POINT.latitude))
      expect(html).not.toContain(String(PRIVATE_POINT.longitude))
      expect(JSON.stringify(drawn())).not.toContain(String(PRIVATE_POINT.latitude))
      unmount()
    }
  })

  it("the request for a public listing never asks for an owner or admin route", async () => {
    const { calls } = installFetchMock(fakeBackend())
    renderPage(<BusinessProfilePage />, { url: `/businesses/${IDS.generalExact}`, path: "/businesses/:id", user: null })
    await screen.findByRole("heading", { level: 1, name: "Glow Salon" })
    expect(calls.every((c) => !c.path.startsWith("/admin") && !c.path.startsWith("/users/me"))).toBe(true)
  })
})
