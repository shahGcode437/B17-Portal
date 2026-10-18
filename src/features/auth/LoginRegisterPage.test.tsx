import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ToastContext } from "@/hooks/useToast"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { LoginRegisterPage } from "@/features/auth/LoginRegisterPage"
import { getCsrfToken } from "@/lib/api/session"
import { deferred, fail, installFetchMock, meBody, ok } from "@/test/apiMock"

const navigation = vi.hoisted(() => ({ assignLocation: vi.fn() }))
vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  assignLocation: navigation.assignLocation,
}))

type Backend = Parameters<typeof installFetchMock>[0]

function renderLogin(entry: string | { pathname: string; state?: unknown } = "/login", backend?: Backend) {
  const handler: Backend =
    backend ?? ((call) => (call.path === "/auth/me" ? fail(401, "unauthenticated") : fail(404, "not_found")))
  const mocked = installFetchMock(handler)
  const show = vi.fn()
  render(
    <ToastContext.Provider value={{ show }}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRegisterPage />} />
            <Route path="/register" element={<LoginRegisterPage />} />
            <Route path="/" element={<h1>Home page</h1>} />
            <Route path="/saved-page" element={<h1>Saved page</h1>} />
            <Route path="/providers/:id" element={<h1>Provider page</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </ToastContext.Provider>
  )
  return { ...mocked, show, user: userEvent.setup() }
}

async function ready() {
  await screen.findByRole("heading", { level: 1, name: /log in|create account/i })
}

beforeEach(() => {
  window.history.replaceState({}, "", "/login")
})
afterEach(() => {
  window.history.replaceState({}, "", "/")
})

describe("LoginRegisterPage — loading and redirects", () => {
  it("shows a status (not the form) until /auth/me answers, so an authenticated user never sees a flash", async () => {
    const gate = deferred<ReturnType<typeof ok>>()
    renderLogin("/login", (call) => (call.path === "/auth/me" ? gate.promise : fail(404, "x")))

    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i)
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument()

    gate.resolve(ok(meBody()))
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument()
  })

  it("sends an already-signed-in visitor on to the page they came for", async () => {
    renderLogin({ pathname: "/login", state: { from: "/saved-page" } }, () => ok(meBody()))

    expect(await screen.findByRole("heading", { name: "Saved page" })).toBeInTheDocument()
  })

  it("ignores an unsafe 'from' (open-redirect attempt) and goes home", async () => {
    renderLogin({ pathname: "/login", state: { from: "https://evil.example/phish" } }, () => ok(meBody()))

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument()
  })

  it("resumes an interrupted Request Service intent", async () => {
    renderLogin({ pathname: "/login", state: { providerId: "p-1", from: "/providers/p-1" } }, () => ok(meBody()))

    expect(await screen.findByRole("heading", { name: "Provider page" })).toBeInTheDocument()
  })
})

describe("LoginRegisterPage — email + password login", () => {
  it("validates before calling the server", async () => {
    const { calls, user } = renderLogin()
    await ready()

    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument()
    expect(screen.getByText("Enter your password.")).toBeInTheDocument()
    expect(calls.some((call) => call.path === "/auth/login")).toBe(false)
  })

  it("logs in with the real endpoint and navigates; the CSRF token is held in memory", async () => {
    const { calls, user } = renderLogin("/login", (call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      if (call.path === "/auth/login") return ok(meBody({ csrfToken: "csrf-after-login" }))
      return fail(404, "x")
    })
    await ready()

    await user.type(screen.getByLabelText("Email"), "ayesha@example.org")
    await user.type(screen.getByLabelText("Password"), "correct horse battery")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument()
    expect(calls.find((c) => c.path === "/auth/login")!.body).toEqual({
      email: "ayesha@example.org",
      password: "correct horse battery",
    })
    expect(getCsrfToken()).toBe("csrf-after-login")
    expect(window.location.search).toBe("") // the password never goes near the URL
    expect(window.location.href).not.toContain("correct")
  })

  it("shows ONE generic message for wrong credentials (no unknown-email vs wrong-password hint)", async () => {
    const { user } = renderLogin("/login", (call) =>
      call.path === "/auth/me" ? fail(401, "unauthenticated") : fail(401, "invalid_credentials")
    )
    await ready()

    await user.type(screen.getByLabelText("Email"), "nobody@example.org")
    await user.type(screen.getByLabelText("Password"), "whatever-it-is")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument()
    expect(screen.queryByText(/unknown|not found|no account/i)).not.toBeInTheDocument()
  })

  it.each([
    ["rate_limited", 429, /too many attempts/i],
    ["account_disabled", 403, /isn't available/i],
  ])("handles %s calmly", async (code, status, text) => {
    const { user } = renderLogin("/login", (call) =>
      call.path === "/auth/me" ? fail(401, "unauthenticated") : fail(status, code)
    )
    await ready()
    await user.type(screen.getByLabelText("Email"), "a@b.co")
    await user.type(screen.getByLabelText("Password"), "some password")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it("distinguishes a network failure from a wrong password", async () => {
    const { user } = renderLogin("/login", (call) => (call.path === "/auth/me" ? fail(401, "unauthenticated") : "network-error"))
    await ready()
    await user.type(screen.getByLabelText("Email"), "a@b.co")
    await user.type(screen.getByLabelText("Password"), "some password")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument()
  })

  it("disables the button while submitting so a double click cannot send two requests", async () => {
    const gate = deferred<ReturnType<typeof ok>>()
    const { calls, user } = renderLogin("/login", (call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      return gate.promise
    })
    await ready()
    await user.type(screen.getByLabelText("Email"), "a@b.co")
    await user.type(screen.getByLabelText("Password"), "some password")

    await user.click(screen.getByRole("button", { name: /^log in$/i }))
    const busy = await screen.findByRole("button", { name: /logging in/i })
    expect(busy).toBeDisabled()
    await user.click(busy)
    gate.resolve(ok(meBody()))
    await screen.findByRole("heading", { name: "Home page" })

    expect(calls.filter((c) => c.path === "/auth/login")).toHaveLength(1)
  })

  it("maps a backend 422 onto the named field", async () => {
    const { user } = renderLogin("/login", (call) =>
      call.path === "/auth/me"
        ? fail(401, "unauthenticated")
        : fail(422, "validation_error", [{ field: "email", code: "invalid_email", message: "Enter a valid email address." }])
    )
    await ready()
    await user.type(screen.getByLabelText("Email"), "not-an-email")
    await user.type(screen.getByLabelText("Password"), "some password")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))

    const field = screen.getByLabelText("Email")
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-invalid", "true")
  })

  it("has accessible, correctly typed fields and a password toggle", async () => {
    const { user } = renderLogin()
    await ready()

    const email = screen.getByLabelText("Email")
    const password = screen.getByLabelText("Password")
    expect(email).toHaveAttribute("type", "email")
    expect(email).toHaveAttribute("autocomplete", "username")
    expect(password).toHaveAttribute("type", "password")
    expect(password).toHaveAttribute("autocomplete", "current-password")

    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(password).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("link", { name: /forgot your password/i })).toHaveAttribute("href", "/forgot-password")
  })
})

describe("LoginRegisterPage — registration", () => {
  it("registers with exactly email, password and displayName, then is signed in", async () => {
    const { calls, user, show } = renderLogin("/register", (call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      if (call.path === "/auth/register") return ok(meBody({ emailVerified: false, displayName: "New Person" }), 201)
      return fail(404, "x")
    })
    await screen.findByRole("heading", { level: 1, name: "Create Account" })

    await user.type(screen.getByLabelText("Your name"), "New Person")
    await user.type(screen.getByLabelText("Email"), "new@example.org")
    await user.type(screen.getByLabelText("Password"), "a long passphrase")
    await user.click(screen.getByRole("button", { name: /^create account$/i }))

    expect(await screen.findByRole("heading", { name: "Home page" })).toBeInTheDocument()
    const body = calls.find((c) => c.path === "/auth/register")!.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["displayName", "email", "password"])
    expect(show).toHaveBeenCalledWith(expect.stringMatching(/verify your address/i))
  })

  it("enforces the stable 10–128 character policy in the UI, but leaves the real check to the server", async () => {
    const { calls, user } = renderLogin("/register")
    await screen.findByRole("heading", { level: 1, name: "Create Account" })

    await user.type(screen.getByLabelText("Your name"), "Ab")
    await user.type(screen.getByLabelText("Email"), "ab@example.org")
    await user.type(screen.getByLabelText("Password"), "short")
    await user.click(screen.getByRole("button", { name: /^create account$/i }))

    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument()
    expect(calls.some((c) => c.path === "/auth/register")).toBe(false)
  })

  it("reports an existing address on the email field", async () => {
    const { user } = renderLogin("/register", (call) =>
      call.path === "/auth/me" ? fail(401, "unauthenticated") : fail(409, "email_already_registered")
    )
    await screen.findByRole("heading", { level: 1, name: "Create Account" })
    await user.type(screen.getByLabelText("Your name"), "Ab Cd")
    await user.type(screen.getByLabelText("Email"), "taken@example.org")
    await user.type(screen.getByLabelText("Password"), "a long passphrase")
    await user.click(screen.getByRole("button", { name: /^create account$/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
  })
})

describe("LoginRegisterPage — Google", () => {
  it("starts the flow with a safe returnTo and navigates the browser to the backend-issued URL", async () => {
    navigation.assignLocation.mockClear()
    const { calls, user } = renderLogin({ pathname: "/login", state: { from: "/providers/p-1?x=1" } }, (call) => {
      if (call.path === "/auth/me") return fail(401, "unauthenticated")
      if (call.path === "/auth/oauth/google/start") return ok({ authorizationUrl: "https://accounts.example.test/o/oauth2/v2/auth?state=s" })
      return fail(404, "x")
    })
    await ready()

    await user.click(screen.getByRole("button", { name: "Continue with Google" }))

    await waitFor(() => expect(navigation.assignLocation).toHaveBeenCalledWith("https://accounts.example.test/o/oauth2/v2/auth?state=s"))
    const start = calls.find((c) => c.path === "/auth/oauth/google/start")!
    expect(start.body).toEqual({ purpose: "login", returnTo: "/providers/p-1" }) // path only
    expect(start.headers.has("X-CSRF-Token")).toBe(false) // pre-session
    expect(start.credentials).toBe("include")
  })

  it("explains clearly when Google sign-in is not configured (503)", async () => {
    navigation.assignLocation.mockClear()
    const { user } = renderLogin("/login", (call) =>
      call.path === "/auth/me" ? fail(401, "unauthenticated") : fail(503, "service_unavailable")
    )
    await ready()

    await user.click(screen.getByRole("button", { name: "Continue with Google" }))

    expect(await screen.findByText(/google sign-in isn't available/i)).toBeInTheDocument()
    expect(navigation.assignLocation).not.toHaveBeenCalled()
  })

  it("refuses to navigate to a non-http(s) URL even if the backend returned one", async () => {
    navigation.assignLocation.mockClear()
    const { user } = renderLogin("/login", (call) =>
      call.path === "/auth/me" ? fail(401, "unauthenticated") : ok({ authorizationUrl: "javascript:alert(1)" })
    )
    await ready()

    await user.click(screen.getByRole("button", { name: "Continue with Google" }))

    expect(await screen.findByText(/couldn't start google sign-in/i)).toBeInTheDocument()
    expect(navigation.assignLocation).not.toHaveBeenCalled()
  })

  it.each([
    ["oauth_denied", /cancelled/i],
    ["oauth_failed", /couldn't complete google sign-in/i],
    ["identity_conflict", /existing email and password/i],
    ["email_not_verified", /couldn't confirm this email/i],
    ["account_disabled", /isn't available/i],
  ])("shows the safe message for the callback error %s and strips it from the URL", async (code, text) => {
    window.history.replaceState({}, "", `/login?error=${code}`)
    renderLogin(`/login?error=${code}`)

    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(window.location.search).toBe(""))
  })

  it("shows only a generic message for an unknown error value and never echoes it", async () => {
    window.history.replaceState({}, "", "/login?error=<script>alert(1)</script>")
    renderLogin("/login")

    expect(await screen.findByText(/couldn't complete google sign-in/i)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain("<script>alert")
    await waitFor(() => expect(window.location.search).toBe(""))
  })
})

describe("LoginRegisterPage — session notice", () => {
  it("tells a visitor whose session ended why, once", async () => {
    renderLogin("/login", (call) => (call.path === "/auth/me" ? fail(401, "session_expired") : fail(404, "x")))

    expect(await screen.findByText(/your session has ended/i)).toBeInTheDocument()
  })
})
