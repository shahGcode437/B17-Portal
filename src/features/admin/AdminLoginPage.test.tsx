import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AdminLoginPage } from "@/features/admin/AdminLoginPage"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { ApiError, NETWORK_ERROR_CODE } from "@/lib/api/errors"
import { adminUser, authContextValue, testUser } from "@/test/authFixtures"

function renderAdminLogin(auth: AuthContextValue) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/admin/login"]}>
        <AdminLoginPage />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("AdminLoginPage: the auth states stay distinct", () => {
  it("while the session is being checked: a status, no form", () => {
    renderAdminLogin(authContextValue({ status: "loading", user: null }))
    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i)
    expect(screen.queryByRole("button", { name: /^log in$/i })).not.toBeInTheDocument()
  })

  it("an unreachable server says so, and offers to check again (it is not 'logged out')", async () => {
    const retryBootstrap = vi.fn()
    renderAdminLogin(
      authContextValue({
        status: "unavailable",
        user: null,
        retryBootstrap,
        bootstrapError: new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "x" }),
      })
    )
    expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }))
    expect(retryBootstrap).toHaveBeenCalledTimes(1)
  })

  it("an ordinary signed-in account is told it is not an administrator (not shown a login form)", () => {
    renderAdminLogin(authContextValue({ user: testUser({ displayName: "Rana" }) }))
    expect(screen.getByRole("alert")).toHaveTextContent(/signed in as Rana, which isn't an administrator/i)
    expect(screen.getByRole("button", { name: /log out to switch account/i })).toBeInTheDocument()
  })

  it("an administrator is sent on to the dashboard", () => {
    renderAdminLogin(authContextValue({ user: adminUser() }))
    expect(screen.queryByRole("heading", { level: 1, name: "Admin Login" })).not.toBeInTheDocument()
  })
})
