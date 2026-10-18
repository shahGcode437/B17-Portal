import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { Header } from "@/components/navigation/Header"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { authContextValue, testUser } from "@/test/authFixtures"

function renderHeader(auth: AuthContextValue) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("Header account entry", () => {
  it("shows neither 'Log in' nor a name while the session is still being checked", () => {
    renderHeader(authContextValue({ status: "loading", user: null }))

    expect(screen.queryByRole("link", { name: /log in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Ayesha" })).not.toBeInTheDocument()
  })

  it("offers Log in to a visitor", () => {
    renderHeader(authContextValue({ user: null }))

    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login")
  })

  it("shows the real display name, linking to the profile, once authenticated", () => {
    renderHeader(authContextValue({ user: testUser({ displayName: "Ayesha Khan" }) }))

    expect(screen.getByRole("link", { name: /ayesha khan/i })).toHaveAttribute("href", "/profile")
  })
})
