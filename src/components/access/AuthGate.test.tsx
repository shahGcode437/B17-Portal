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
