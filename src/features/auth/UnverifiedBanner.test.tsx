import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UnverifiedBanner } from "@/features/auth/UnverifiedBanner"
import { AuthContext } from "@/hooks/useAuth"
import { authContextValue, testUser } from "@/test/authFixtures"
import type { AuthContextValue } from "@/hooks/useAuth"

/**
 * The unverified-account banner (S5A). A new account used to land on the site with no hint that creating a profile, a
 * listing or a request needs a verified e-mail until an action failed. The banner is a persistent, non-blocking
 * reminder; its production wording never claims an e-mail was sent (production delivery does not exist yet), and the
 * development line is the only place that mentions the dev helper.
 */
afterEach(() => vi.unstubAllEnvs())

function renderBanner(auth: AuthContextValue, path = "/services") {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <UnverifiedBanner />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

const unverified = () => authContextValue({ user: testUser({ emailVerified: false, email: "new@example.org" }) })

describe("who sees it", () => {
  it("an unverified, signed-in account sees it, with a link to the Profile page that holds the full notice", () => {
    renderBanner(unverified())
    const banner = screen.getByRole("complementary", { name: "Your email is not verified" })
    expect(banner).toHaveTextContent("Verify your email.")
    expect(banner).toHaveTextContent(/list a business, service, tutor or property, or send a request/i)
    expect(banner).toHaveTextContent(/browsing works either way/i)
    expect(screen.getByRole("link", { name: "Open your Profile" })).toHaveAttribute("href", "/profile")
  })

  it("a verified account sees nothing", () => {
    renderBanner(authContextValue({ user: testUser({ emailVerified: true }) }))
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })

  it("a visitor, a session still being checked, and an unreachable server see nothing (never a guess)", () => {
    for (const auth of [
      authContextValue({ user: null }),
      authContextValue({ status: "loading", user: null }),
      authContextValue({ status: "unavailable", user: null }),
    ]) {
      const { unmount } = renderBanner(auth)
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
      unmount()
    }
  })

  it("it stays out of the way on the screens that already carry the full notice or ARE the verification step", () => {
    for (const path of ["/profile", "/profile/", "/verify-email"]) {
      const { unmount } = renderBanner(unverified(), path)
      expect(screen.queryByRole("complementary"), path).not.toBeInTheDocument()
      unmount()
    }
    // ...but a sub-page of the profile (Saved, My Requests) keeps it.
    renderBanner(unverified(), "/profile/requests")
    expect(screen.getByRole("complementary")).toBeInTheDocument()
  })

  it("it is persistent, not a dialog: no close control and it never takes focus", () => {
    renderBanner(unverified())
    const banner = screen.getByRole("complementary")
    expect(banner.querySelector("button")).toBeNull()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(banner).not.toContainElement(document.activeElement as HTMLElement | null)
  })

  it("its accessible name does not collide with the Profile notice's region", () => {
    renderBanner(unverified())
    expect(screen.queryByRole("region", { name: "Email verification" })).not.toBeInTheDocument()
  })
})

describe("production versus development wording", () => {
  it("production never claims an e-mail was sent and never mentions the dev helper", () => {
    vi.stubEnv("DEV", false)
    renderBanner(unverified())
    const banner = screen.getByRole("complementary")
    expect(banner).not.toHaveTextContent(/we sent|on its way|inbox|check your e-?mail|dev_verify|development|no e-mail is sent/i)
  })

  it("development says honestly that no e-mail is sent and points at the Profile for the way to verify", () => {
    vi.stubEnv("DEV", true)
    renderBanner(unverified())
    const banner = screen.getByRole("complementary")
    expect(banner).toHaveTextContent(/development: no e-mail is sent/i)
    expect(banner).not.toHaveTextContent(/we sent|on its way|inbox/i)
    // The command itself lives on the Profile page, not in a banner on every screen.
    expect(banner).not.toHaveTextContent("dev_verify")
  })
})
