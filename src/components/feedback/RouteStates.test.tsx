import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RouteError } from "@/components/feedback/RouteError"
import { RouteFallback } from "@/components/feedback/RouteFallback"
import { PwaStatus } from "@/components/pwa/PwaStatus"

const setOnline = (value: boolean) => vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value)

afterEach(() => vi.restoreAllMocks())

describe("RouteFallback", () => {
  it("announces a plain 'Loading page' status (no fake progress)", () => {
    render(<RouteFallback />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading page")
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})

describe("RouteError", () => {
  it("says 'You're offline' (as the page's h1) with a retry action when offline", () => {
    setOnline(false)
    render(<RouteError error={new TypeError("Failed to fetch dynamically imported module: /assets/NewsListPage.js")} />)
    expect(screen.getByRole("heading", { level: 1, name: "You're offline" })).toBeInTheDocument()
    expect(screen.getByText("Check your connection and try again.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("explains a failed page download when online (e.g. a chunk replaced by a newer deploy)", () => {
    setOnline(true)
    render(<RouteError error={new TypeError("Failed to fetch dynamically imported module: /assets/X.js")} />)
    expect(screen.getByRole("heading", { level: 1, name: "This page couldn't load" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("falls back to a neutral message for any other error", () => {
    setOnline(true)
    render(<RouteError error={new Error("boom")} />)
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument()
    expect(screen.getByText("Please try again.")).toBeInTheDocument()
  })
})

describe("PwaStatus", () => {
  it("keeps a permanently-mounted polite live region and shows nothing while online and up to date", () => {
    setOnline(true)
    render(<PwaStatus />)
    const region = screen.getByRole("status")
    expect(region).toHaveAttribute("aria-live", "polite")
    expect(region).toBeEmptyDOMElement()
  })

  it("shows the offline notice (not claiming anything was saved) while offline", () => {
    setOnline(false)
    render(<PwaStatus />)
    expect(screen.getByRole("status")).toHaveTextContent("You're offline. Pages you haven't opened yet may not load.")
  })
})
