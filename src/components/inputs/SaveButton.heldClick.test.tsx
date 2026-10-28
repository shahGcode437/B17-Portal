import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SaveButton } from "@/components/inputs/SaveButton"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { _resetSavedSetForTests } from "@/hooks/useSavedSet"
import { ToastContext } from "@/hooks/useToast"
import { IDS, SAVED } from "@/test/fixtures/apiFixtures"
import { deferred, fail, installFetchMock, meBody, noContent, ok, okPage, type MockReply } from "@/test/apiMock"

/**
 * The held click (`useSignInGate`) through the REAL auth provider, the real saved set and the real write call - only
 * `fetch` is faked, and `/auth/me` is answered when the test says so. The component tests next door swap a context
 * value; this is the path a person actually takes on a deep link: heart clicked while the session check is still open.
 */
function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}</p>
}

function setup(answer: Promise<MockReply>) {
  const { calls } = installFetchMock((call) => {
    if (call.path === "/auth/me") return answer
    if (call.method === "GET" && call.path === "/saved") return okPage(SAVED) // this provider is ALREADY in the saved list
    if (call.path === `/saved/${IDS.provider}`) return noContent()
    return fail(404, "not_found")
  })
  const show = vi.fn()
  render(
    <StrictMode>
      <AuthProvider>
        <ToastContext.Provider value={{ show }}>
          <MemoryRouter initialEntries={[`/providers/${IDS.provider}`]}>
            <Routes>
              <Route path="/providers/:id" element={<SaveButton kind="provider" id={IDS.provider} name="Sunrise Solar Solutions" />} />
              <Route path="/login" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </ToastContext.Provider>
      </AuthProvider>
    </StrictMode>
  )
  const writes = () => calls.filter((call) => call.method === "PUT" || call.method === "DELETE")
  return { calls, writes, show, user: userEvent.setup() }
}

describe("SaveButton: a heart clicked while /auth/me is still unanswered", () => {
  beforeEach(() => _resetSavedSetForTests())

  it("is held across the real answer: ONE save on the same button, with the CSRF token that answer delivered, no Log In", async () => {
    const answer = deferred<MockReply>()
    const { writes, show, user } = setup(answer.promise)
    const heart = screen.getByRole("button", { name: "Save Sunrise Solar Solutions" })
    await user.click(heart)
    expect(writes()).toHaveLength(0) // held: nothing is sent while the session question is open
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()

    await act(async () => answer.resolve(ok(meBody({ csrfToken: "csrf-held" }))))
    await waitFor(() => expect(writes()).toHaveLength(1))
    // A Save, as the heart said when it was clicked - although the saved list that loads right after already holds
    // this provider and flips the heart to "Remove".
    expect(writes()[0].method).toBe("PUT")
    expect(writes()[0].path).toBe(`/saved/${IDS.provider}`)
    expect(writes()[0].headers.get("X-CSRF-Token")).toBe("csrf-held")
    expect(await screen.findByRole("button", { name: "Remove Sunrise Solar Solutions from saved" })).toBe(heart) // never re-mounted
    await waitFor(() => expect(show).toHaveBeenCalledWith("Saved Sunrise Solar Solutions"))
    expect(writes()).toHaveLength(1)
    expect(screen.queryByTestId("where")).not.toBeInTheDocument()
  })

  it("whose answer is 'not signed in' goes to Log In, and nothing is saved", async () => {
    const answer = deferred<MockReply>()
    const { writes, user } = setup(answer.promise)
    await user.click(screen.getByRole("button", { name: "Save Sunrise Solar Solutions" }))

    await act(async () => answer.resolve(fail(401, "unauthenticated")))
    expect(await screen.findByTestId("where")).toHaveTextContent("/login")
    expect(writes()).toHaveLength(0)
  })
})
