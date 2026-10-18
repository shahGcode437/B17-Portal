import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
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
