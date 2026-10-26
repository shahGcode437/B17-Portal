import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { ToastContext } from "@/hooks/useToast"
import { useSignInGate } from "@/hooks/useSignInGate"
import { authContextValue } from "@/test/authFixtures"

function Where() {
  const location = useLocation()
  const state = location.state as { from?: string; providerId?: string } | null
  return <p data-testid="where">{`${location.pathname}|${state?.from ?? ""}|${state?.providerId ?? ""}`}</p>
}

/** A button that needs a signed-in person, on a page anyone can open. */
function Action({ run }: { run: () => void }) {
  const { requireSignIn } = useSignInGate()
  return (
    <button type="button" onClick={() => requireSignIn(run, { loginState: { providerId: "p-1" } })}>
      do it
    </button>
  )
}

function setup(auth: AuthContextValue, run = vi.fn()) {
  const show = vi.fn()
  const tree = (value: AuthContextValue) => (
    <AuthContext.Provider value={value}>
      <ToastContext.Provider value={{ show }}>
        <MemoryRouter initialEntries={["/providers/p-1?tab=2"]}>
          <Routes>
            <Route path="/providers/:id" element={<Action run={run} />} />
            <Route path="/login" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastContext.Provider>
    </AuthContext.Provider>
  )
  const utils = render(tree(auth))
  return { run, show, user: userEvent.setup(), becomes: (next: AuthContextValue) => act(async () => utils.rerender(tree(next))) }
}

const loading = (extra: Partial<AuthContextValue> = {}) => authContextValue({ status: "loading", user: null, ...extra })
const unavailable = (extra: Partial<AuthContextValue> = {}) => authContextValue({ status: "unavailable", user: null, ...extra })

describe("useSignInGate: Bug C (a signed-in person is sent to Log In)", () => {
  it("authenticated: the action runs at once, no Log In", async () => {
    const { run, user } = setup(authContextValue())
    await user.click(screen.getByRole("button", { name: "do it" }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
  })

  it("anonymous: Log In, remembering the page (path + query) and the intent", async () => {
    const { run, user } = setup(authContextValue({ user: null }))
    await user.click(screen.getByRole("button", { name: "do it" }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByTestId("where")).toHaveTextContent("/login|/providers/p-1?tab=2|p-1")
  })

  it("loading: NOT sent to Log In; the click is held and runs when the answer says signed in", async () => {
    const { run, user, becomes } = setup(loading())
    await user.click(screen.getByRole("button", { name: "do it" }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()

    await becomes(authContextValue())
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()

    await becomes(authContextValue()) // a later render must not run it again
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("loading, then the answer is anonymous: Log In (that is the one case that needs it)", async () => {
    const { run, user, becomes } = setup(loading())
    await user.click(screen.getByRole("button", { name: "do it" }))
    await becomes(authContextValue({ user: null }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByTestId("where")).toHaveTextContent("/login|/providers/p-1?tab=2|p-1")
  })

  it("loading, then the server is unreachable: an honest message, not Log In", async () => {
    const { run, show, user, becomes } = setup(loading())
    await user.click(screen.getByRole("button", { name: "do it" }))
    await becomes(unavailable())
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    expect(show).toHaveBeenCalledWith(expect.stringMatching(/couldn't reach the server/i), { tone: "error" })
  })

  it("unavailable: not Log In either; the session is re-checked once, and a recovery completes the click", async () => {
    const retryBootstrap = vi.fn()
    const { run, show, user, becomes } = setup(unavailable({ retryBootstrap }))
    await user.click(screen.getByRole("button", { name: "do it" }))
    expect(retryBootstrap).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    expect(show).not.toHaveBeenCalled() // the re-check is still running

    await becomes(loading()) // retryBootstrap -> loading ...
    await becomes(authContextValue()) // ... -> the session is fine
    expect(run).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()
  })

  it("unavailable and still unreachable after the re-check: says so and goes nowhere", async () => {
    const { run, show, user, becomes } = setup(unavailable())
    await user.click(screen.getByRole("button", { name: "do it" }))
    await becomes(loading())
    await becomes(unavailable())
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
    expect(show).toHaveBeenCalledTimes(1)
  })
})
