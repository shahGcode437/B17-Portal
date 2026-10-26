import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SaveButton } from "@/components/inputs/SaveButton"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { _resetSavedSetForTests } from "@/hooks/useSavedSet"
import { ToastContext } from "@/hooks/useToast"
import { saveListing, unsaveListing } from "@/lib/api/writes/saved"
import { authContextValue } from "@/test/authFixtures"

vi.mock("@/lib/api/reads/saved", () => ({
  fetchSaved: vi.fn(async () => ({ items: [], meta: { total: 0, limit: 50, offset: 0 }, extra: {} })),
}))
vi.mock("@/lib/api/writes/saved", () => ({
  saveListing: vi.fn(async () => undefined),
  unsaveListing: vi.fn(async () => undefined),
}))

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}</p>
}

function setup(auth: AuthContextValue) {
  const show = vi.fn()
  const tree = (value: AuthContextValue) => (
    <AuthContext.Provider value={value}>
      <ToastContext.Provider value={{ show }}>
        <MemoryRouter initialEntries={["/providers/p-1"]}>
          <Routes>
            <Route path="/providers/:id" element={<SaveButton kind="provider" id="p-1" name="Sunrise Solar" />} />
            <Route path="/login" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastContext.Provider>
    </AuthContext.Provider>
  )
  const utils = render(tree(auth))
  return { show, user: userEvent.setup(), becomes: (next: AuthContextValue) => act(async () => utils.rerender(tree(next))) }
}

const heart = () => screen.getByRole("button", { name: "Save Sunrise Solar" })

describe("SaveButton: only an ANONYMOUS visitor is sent to Log In (Bug C)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetSavedSetForTests()
  })

  it("a signed-in person saves; nothing sends them to Log In", async () => {
    const { show, user } = setup(authContextValue())
    await user.click(heart())
    await waitFor(() => expect(saveListing).toHaveBeenCalledWith("p-1"))
    expect(show).toHaveBeenCalledWith("Saved Sunrise Solar")
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
  })

  it("an anonymous visitor is sent to Log In and nothing is saved", async () => {
    const { user } = setup(authContextValue({ user: null }))
    await user.click(heart())
    expect(screen.getByTestId("where")).toHaveTextContent("/login")
    expect(saveListing).not.toHaveBeenCalled()
  })

  it("while the session is still being checked: no Log In; the save happens when the answer says signed in", async () => {
    const { show, user, becomes } = setup(authContextValue({ status: "loading", user: null }))
    await user.click(heart())
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    expect(saveListing).not.toHaveBeenCalled()

    await becomes(authContextValue())
    await waitFor(() => expect(saveListing).toHaveBeenCalledTimes(1))
    expect(saveListing).toHaveBeenCalledWith("p-1")
    expect(unsaveListing).not.toHaveBeenCalled()
    await waitFor(() => expect(show).toHaveBeenCalledWith("Saved Sunrise Solar"))
  })

  it("an unreachable server is not 'logged out': it re-checks once and goes nowhere", async () => {
    const retryBootstrap = vi.fn()
    const { user } = setup(authContextValue({ status: "unavailable", user: null, retryBootstrap }))
    await user.click(heart())
    expect(retryBootstrap).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    expect(saveListing).not.toHaveBeenCalled()
  })
})
