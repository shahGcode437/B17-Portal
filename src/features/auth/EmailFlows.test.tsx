import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage"
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { VerifyEmailPage } from "@/features/auth/VerifyEmailPage"
import { clearFragmentToken, captureFragmentToken } from "@/lib/fragmentToken"
import { fail, installFetchMock, meBody, noContent, ok } from "@/test/apiMock"

type Backend = Parameters<typeof installFetchMock>[0]

function renderRoute(url: string, element: React.ReactNode, backend: Backend, path: string) {
  const mocked = installFetchMock(backend)
  // What the browser (and `main.tsx`) does for a full page load of an e-mail link:
  window.history.replaceState({}, "", url)
  captureFragmentToken()
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={element} />
          <Route path="/login" element={<h1>Log In page</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
  return { ...mocked, user: userEvent.setup() }
}

afterEach(() => {
  clearFragmentToken()
  document.head.querySelectorAll('meta[name="referrer"]').forEach((node) => node.remove())
  window.history.replaceState({}, "", "/")
})

describe("VerifyEmailPage", () => {
  it("strips the fragment, sends the token exactly once, then refreshes /auth/me", async () => {
    let verified = false
    const { calls } = renderRoute(
      "/verify-email#token=tok-123",
      <VerifyEmailPage />,
      (call) => {
        if (call.path === "/auth/verify-email") {
          verified = true
          return noContent()
        }
        return call.path === "/auth/me" ? ok(meBody({ emailVerified: verified })) : fail(404, "x")
      },
      "/verify-email"
    )

    expect(window.location.hash).toBe("") // gone before anything else ran
    expect(await screen.findByText(/your email address is verified/i)).toBeInTheDocument()

    const verify = calls.filter((c) => c.path === "/auth/verify-email")
    expect(verify).toHaveLength(1) // StrictMode-safe: the one-time token is spent once
    expect(verify[0].body).toEqual({ token: "tok-123" })
    expect(verify[0].headers.has("X-CSRF-Token")).toBe(false)
    expect(calls.filter((c) => c.path === "/auth/me").length).toBeGreaterThanOrEqual(2) // bootstrap + refresh
    expect(window.location.href).not.toContain("tok-123")
  })

  it("sets Referrer-Policy: no-referrer while the page is shown", async () => {
    renderRoute("/verify-email#token=t", <VerifyEmailPage />, (c) => (c.path === "/auth/verify-email" ? noContent() : fail(401, "unauthenticated")), "/verify-email")

    await screen.findByText(/your email address is verified/i)

    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer")
  })

  it.each([
    ["token_invalid", 400, /invalid or has already been used/i],
    ["token_expired", 400, /has expired/i],
  ])("handles %s", async (code, status, text) => {
    renderRoute(
      "/verify-email#token=t",
      <VerifyEmailPage />,
      (c) => (c.path === "/auth/verify-email" ? fail(status, code) : fail(401, "unauthenticated")),
      "/verify-email"
    )

    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it("explains an incomplete link without calling the server", async () => {
    const { calls } = renderRoute("/verify-email", <VerifyEmailPage />, () => fail(401, "unauthenticated"), "/verify-email")

    expect(await screen.findByText(/link is incomplete/i)).toBeInTheDocument()
    expect(calls.some((c) => c.path === "/auth/verify-email")).toBe(false)
  })

  it("never persists the token anywhere in web storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    renderRoute("/verify-email#token=very-secret-token", <VerifyEmailPage />, (c) => (c.path === "/auth/verify-email" ? noContent() : fail(401, "unauthenticated")), "/verify-email")

    await screen.findByText(/your email address is verified/i)

    expect(JSON.stringify(setItem.mock.calls)).not.toContain("very-secret-token")
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain("very-secret-token")
  })
})

describe("ForgotPasswordPage", () => {
  async function submit(email: string, backend: Backend) {
    const view = renderRoute("/forgot-password", <ForgotPasswordPage />, backend, "/forgot-password")
    await screen.findByRole("heading", { level: 1, name: /forgot password/i })
    await view.user.type(screen.getByLabelText("Email"), email)
    await view.user.click(screen.getByRole("button", { name: "Send reset link" }))
    return view
  }

  it("shows the SAME neutral confirmation for any address (the server always says accepted)", async () => {
    const answer: Backend = (c) => (c.path === "/auth/forgot-password" ? ok({ status: "accepted" }, 202) : fail(401, "unauthenticated"))
    await submit("exists@example.org", answer)
    const first = (await screen.findByRole("status")).textContent
    document.body.innerHTML = ""
    await submit("nobody-at-all@example.org", answer)
    const second = (await screen.findByRole("status")).textContent

    expect(first).toMatch(/if an account exists/i)
    expect(second).toBe(first)
  })

  it("sends only the email, with no CSRF header (pre-session)", async () => {
    const { calls } = await submit("a@example.org", (c) => (c.path === "/auth/forgot-password" ? ok({ status: "accepted" }, 202) : fail(401, "unauthenticated")))

    await screen.findByRole("status")
    const call = calls.find((c) => c.path === "/auth/forgot-password")!
    expect(call.body).toEqual({ email: "a@example.org" })
    expect(call.headers.has("X-CSRF-Token")).toBe(false)
  })

  it("handles rate limiting without claiming anything about the account", async () => {
    await submit("a@example.org", (c) => (c.path === "/auth/forgot-password" ? fail(429, "rate_limited") : fail(401, "unauthenticated")))

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument()
    expect(screen.queryByText(/if an account exists/i)).not.toBeInTheDocument()
  })
})

describe("ResetPasswordPage", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
    await screen.findByRole("heading", { level: 1, name: /reset password/i })
    await user.type(screen.getByLabelText("New password"), password)
    await user.type(screen.getByLabelText("Confirm new password"), confirm)
    await user.click(screen.getByRole("button", { name: "Set new password" }))
  }

  it("strips the fragment, posts token + newPassword, and stays ANONYMOUS afterwards", async () => {
    const { calls, user } = renderRoute(
      "/reset-password#token=reset-tok",
      <ResetPasswordPage />,
      (c) => (c.path === "/auth/reset-password" ? noContent() : fail(401, "unauthenticated")),
      "/reset-password"
    )
    expect(window.location.hash).toBe("")

    await fill(user, "a brand new passphrase")

    expect(await screen.findByText(/your password has been changed/i)).toBeInTheDocument()
    expect(calls.find((c) => c.path === "/auth/reset-password")!.body).toEqual({
      token: "reset-tok",
      newPassword: "a brand new passphrase",
    })
    expect(screen.getByRole("link", { name: "Go to log in" })).toHaveAttribute("href", "/login")
    // No local session was invented: no login call, and /auth/me was asked again and said 401.
    expect(calls.some((c) => c.path === "/auth/login")).toBe(false)
    expect(window.location.href).not.toContain("reset-tok")
  })

  it("requires the two passwords to match, before calling the server", async () => {
    const { calls, user } = renderRoute("/reset-password#token=t", <ResetPasswordPage />, () => fail(401, "unauthenticated"), "/reset-password")

    await fill(user, "a brand new passphrase", "a different passphrase")

    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument()
    expect(calls.some((c) => c.path === "/auth/reset-password")).toBe(false)
  })

  it.each([
    ["token_invalid", /fail|wrong|already/i, /invalid or has already been used/i],
    ["token_expired", /expired/i, /has expired/i],
  ])("shows a safe message for %s", async (code, _a, text) => {
    const { user } = renderRoute(
      "/reset-password#token=t",
      <ResetPasswordPage />,
      (c) => (c.path === "/auth/reset-password" ? fail(400, code) : fail(401, "unauthenticated")),
      "/reset-password"
    )

    await fill(user, "a brand new passphrase")

    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it("maps a weak-password 422 onto the field", async () => {
    const { user } = renderRoute(
      "/reset-password#token=t",
      <ResetPasswordPage />,
      (c) =>
        c.path === "/auth/reset-password"
          ? fail(422, "validation_error", [{ field: "newPassword", code: "too_common", message: "Choose a less common password." }])
          : fail(401, "unauthenticated"),
      "/reset-password"
    )

    await fill(user, "password12345")

    expect(await screen.findByText("Choose a less common password.")).toBeInTheDocument()
  })

  it("without a token it offers a new link instead of a form", async () => {
    renderRoute("/reset-password", <ResetPasswordPage />, () => fail(401, "unauthenticated"), "/reset-password")

    expect(await screen.findByText(/incomplete or has already been used/i)).toBeInTheDocument()
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer")
  })
})

describe("VerificationNotice", () => {
  function renderNotice(backend: Backend) {
    const mocked = installFetchMock(backend)
    render(
      <MemoryRouter>
        <AuthProvider>
          <VerificationNotice />
        </AuthProvider>
      </MemoryRouter>
    )
    return { ...mocked, user: userEvent.setup() }
  }

  it("is absent for a verified user and for visitors", async () => {
    renderNotice(() => ok(meBody({ emailVerified: true })))
    await act(async () => {})
    expect(screen.queryByText(/verify your email address/i)).not.toBeInTheDocument()
  })

  it("resends through the authenticated, CSRF-protected endpoint and confirms neutrally", async () => {
    const { calls, user } = renderNotice((c) =>
      c.path === "/auth/resend-verification" ? noContent() : ok(meBody({ emailVerified: false, csrfToken: "csrf-r" }))
    )

    await user.click(await screen.findByRole("button", { name: "Resend verification email" }))

    expect(await screen.findByText(/if your email still needs verifying/i)).toBeInTheDocument()
    const resend = calls.find((c) => c.path === "/auth/resend-verification")!
    expect(resend.headers.get("X-CSRF-Token")).toBe("csrf-r")
    expect(resend.body).toBeUndefined() // the session says who; no email is sent
  })

  it("respects rate limiting", async () => {
    const { user } = renderNotice((c) =>
      c.path === "/auth/resend-verification" ? fail(429, "rate_limited") : ok(meBody({ emailVerified: false }))
    )

    await user.click(await screen.findByRole("button", { name: "Resend verification email" }))

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument())
  })
})
