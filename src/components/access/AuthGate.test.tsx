import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AuthGate } from "@/components/access/AuthGate"
import { AuthContext } from "@/hooks/useAuth"
import { authContextValue, testUser } from "@/test/authFixtures"
import type { AuthContextValue } from "@/hooks/useAuth"

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}|${(location.state as { from?: string } | null)?.from ?? ""}`}</p>
}

function renderGate(requires: "authenticated" | "professional" | "admin", auth: AuthContextValue, path = "/area?tab=1") {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AuthGate requires={requires} />}>
            <Route path="/area" element={<p>protected content</p>} />
          </Route>
          <Route path="/login" element={<Where />} />
          <Route path="/admin/login" element={<Where />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("AuthGate", () => {
  it("while loading: shows a status, never redirects, never shows protected content", () => {
    renderGate("authenticated", authContextValue({ status: "loading", user: null }))

    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i)
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
  })

  it("anonymous: redirects to Log In remembering the page (path + query) it came from", () => {
    renderGate("authenticated", authContextValue({ user: null }))

    expect(screen.getByTestId("where")).toHaveTextContent("/login|/area?tab=1")
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("anonymous on an admin route: redirects to Admin Login", () => {
    renderGate("admin", authContextValue({ user: null }))

    expect(screen.getByTestId("where")).toHaveTextContent("/admin/login|/area?tab=1")
  })

  it("authenticated: renders the protected route", () => {
    renderGate("authenticated", authContextValue())

    expect(screen.getByText("protected content")).toBeInTheDocument()
  })

  it("server unreachable: offers a retry and does not pretend the user is logged out", async () => {
    const retryBootstrap = vi.fn()
    renderGate("authenticated", authContextValue({ status: "unavailable", user: null, retryBootstrap }))

    expect(screen.getByRole("heading", { level: 1, name: /can't reach the server/i })).toBeInTheDocument()
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }))
    expect(retryBootstrap).toHaveBeenCalledTimes(1)
  })

  describe("the order of the gates for the Professional Workspace (S5A)", () => {
    // loading -> unavailable -> anonymous -> e-mail unverified -> professional profile missing -> allowed
    const unverified = () => testUser({ emailVerified: false, email: "new@example.org" })

    it("an unverified account is told to verify first: no 'Create a professional profile', no content, no Log In", () => {
      renderGate("professional", authContextValue({ user: unverified() }))

      expect(screen.getByRole("heading", { level: 1, name: "Verify your email first" })).toBeInTheDocument()
      expect(screen.queryByRole("heading", { name: /professional profile needed/i })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /create a professional profile/i })).not.toBeInTheDocument()
      expect(screen.queryByText("protected content")).not.toBeInTheDocument()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
      // The full notice (with the resend button) is on the gate itself.
      expect(screen.getByRole("region", { name: "Email verification" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Back to home" })).toBeInTheDocument()
    })

    it("verification comes before the missing profile for any role (an unverified admin is not a shortcut)", () => {
      renderGate("professional", authContextValue({ user: { ...unverified(), roles: ["admin"] } }))
      expect(screen.getByRole("heading", { level: 1, name: "Verify your email first" })).toBeInTheDocument()
    })

    it("a verified resident without a profile gets the profile gate next, never Log In and never the verify gate", () => {
      renderGate("professional", authContextValue({ user: testUser({ emailVerified: true }) }))

      expect(screen.getByRole("heading", { level: 1, name: /professional profile needed/i })).toBeInTheDocument()
      expect(screen.queryByText("Verify your email first")).not.toBeInTheDocument()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Create a professional profile" })).toBeEnabled()
    })

    it("a verified professional is let in", () => {
      renderGate("professional", authContextValue({ user: testUser({ emailVerified: true, professional: { planCode: "free" } }) }))
      expect(screen.getByText("protected content")).toBeInTheDocument()
    })

    it("the earlier gates still win: loading, unreachable and anonymous are decided before verification", () => {
      renderGate("professional", authContextValue({ status: "loading", user: null }))
      expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i)
      expect(screen.queryByText("Verify your email first")).not.toBeInTheDocument()
    })

    it("unreachable server: the retry, not the verify gate", () => {
      renderGate("professional", authContextValue({ status: "unavailable", user: null }))
      expect(screen.getByRole("heading", { level: 1, name: /can't reach the server/i })).toBeInTheDocument()
      expect(screen.queryByText("Verify your email first")).not.toBeInTheDocument()
    })

    it("anonymous: Log In (remembering the page), not the verify gate", () => {
      renderGate("professional", authContextValue({ user: null }))
      expect(screen.getByTestId("where")).toHaveTextContent("/login|/area?tab=1")
      expect(screen.queryByText("Verify your email first")).not.toBeInTheDocument()
    })

    it("the plain signed-in gate does not ask for verification (the Profile pages show the notice instead)", () => {
      renderGate("authenticated", authContextValue({ user: unverified() }))
      expect(screen.getByText("protected content")).toBeInTheDocument()
    })

    it("production wording on the verify gate never claims an e-mail was sent", () => {
      vi.stubEnv("DEV", false)
      try {
        renderGate("professional", authContextValue({ user: unverified() }))
        const gate = screen.getByRole("heading", { level: 1, name: "Verify your email first" }).closest("div") as HTMLElement
        expect(gate).toHaveTextContent("new@example.org is not verified yet.")
        expect(gate).not.toHaveTextContent(/we sent|on its way|inbox|dev_verify|in development/i)
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  describe("professional (a capability from /auth/me, not a role)", () => {
    it("blocks an account without a professional profile", () => {
      renderGate("professional", authContextValue({ user: testUser({ roles: ["admin"] }) })) // even an admin

      expect(screen.getByRole("heading", { level: 1, name: /professional profile needed/i })).toBeInTheDocument()
      expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    })

    it("lets an account with the professional summary in", () => {
      renderGate("professional", authContextValue({ user: testUser({ professional: { planCode: "free" } }) }))

      expect(screen.getByText("protected content")).toBeInTheDocument()
    })
  })

  describe("signed-in states are never mistaken for Log In (Bug C)", () => {
    const pro = () => authContextValue({ user: testUser({ professional: { planCode: "free" } }) })

    function renderTwoPages(auth: AuthContextValue) {
      const tree = (value: AuthContextValue) => (
        <AuthContext.Provider value={value}>
          <MemoryRouter initialEntries={["/provider"]}>
            <Link to="/provider/listings">to listings</Link>
            <Link to="/provider">to overview</Link>
            <Routes>
              <Route element={<AuthGate requires="professional" />}>
                <Route path="/provider" element={<p>overview</p>} />
                <Route path="/provider/listings" element={<p>listings</p>} />
              </Route>
              <Route path="/login" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      )
      const utils = render(tree(auth))
      return { rerender: (next: AuthContextValue) => utils.rerender(tree(next)) }
    }

    it("a resident without a professional profile is told so - there is no Log In in the way", () => {
      renderTwoPages(authContextValue({ user: testUser() }))
      expect(screen.getByRole("heading", { level: 1, name: /professional profile needed/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /create a professional profile/i })).toBeEnabled()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
      expect(screen.queryByText(/log in/i)).not.toBeInTheDocument()
    })

    it("reload: loading, then the professional answer - the workspace opens and Log In is never shown", () => {
      const view = renderTwoPages(authContextValue({ status: "loading", user: null }))
      expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i)
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()

      view.rerender(pro())
      expect(screen.getByText("overview")).toBeInTheDocument()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    })

    it("a resident who then gets the professional capability (the /auth/me refresh) moves straight into the workspace", () => {
      const view = renderTwoPages(authContextValue({ user: testUser() }))
      expect(screen.getByRole("heading", { level: 1, name: /professional profile needed/i })).toBeInTheDocument()
      view.rerender(pro())
      expect(screen.getByText("overview")).toBeInTheDocument()
    })

    it("a professional keeps access across route navigation inside the workspace", async () => {
      renderTwoPages(pro())
      const user = userEvent.setup()
      await user.click(screen.getByRole("link", { name: "to listings" }))
      expect(screen.getByText("listings")).toBeInTheDocument()
      await user.click(screen.getByRole("link", { name: "to overview" }))
      expect(screen.getByText("overview")).toBeInTheDocument()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    })

    it("an unreachable server during a reload is a retryable error, never the Log In page", () => {
      renderTwoPages(authContextValue({ status: "unavailable", user: null }))
      expect(screen.getByRole("heading", { level: 1, name: /can't reach the server/i })).toBeInTheDocument()
      expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    })
  })

  describe("admin (only from the backend roles)", () => {
    it("blocks a signed-in non-admin, with no way to self-promote", () => {
      renderGate("admin", authContextValue({ user: testUser({ professional: { planCode: "premium" } }) }))

      expect(screen.getByRole("heading", { level: 1, name: /admin access only/i })).toBeInTheDocument()
      expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    })

    it("lets an admin in", () => {
      renderGate("admin", authContextValue({ user: testUser({ roles: ["admin"] }) }))

      expect(screen.getByText("protected content")).toBeInTheDocument()
    })
  })
})
