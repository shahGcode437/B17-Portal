import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mailMode, rememberEmailDelivery } from "@/config/devMail"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage"
import { UnverifiedBanner } from "@/features/auth/UnverifiedBanner"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { AuthContext } from "@/hooks/useAuth"
import { fetchMe, forgotPassword, normalizeEmailDelivery } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/errors"
import { userMessageFor } from "@/lib/api/writeErrors"
import { fail, installFetchMock, meBody, noContent, ok } from "@/test/apiMock"
import { authContextValue, testUser } from "@/test/authFixtures"
import type { EmailDelivery } from "@/types/auth"

/**
 * What each screen says follows how the SERVER says it handles e-mail (EMAIL-1). The cases without a reported mode
 * (an older backend) are the existing tests in `EmailFlows.test.tsx` and friends, unchanged.
 */

/** Never allowed anywhere: a claim that a message was sent, delivered or is coming. */
const DELIVERY_CLAIM = /we(?:'ve| have)? sent|has been sent|was sent|have emailed|delivered|on its way/i
const DEVELOPMENT_TEXT = /development|dev_verify|api terminal|no e-?mail is sent|nothing is e-?mailed/i

afterEach(() => {
  rememberEmailDelivery(undefined)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("mailMode", () => {
  it.each([
    // [development build?, reported, mode]
    [true, "email", "inbox"],
    [false, "email", "inbox"],
    [true, "console", "console"],
    [true, "off", "off"],
    [true, undefined, "console"],
    [false, "console", "neutral"],
    [false, "off", "neutral"],
    [false, undefined, "neutral"],
  ] as const)("development=%s reported=%s -> %s", (development, delivery, expected) => {
    vi.stubEnv("DEV", development)
    expect(mailMode(delivery)).toBe(expected)
  })

  it("accepts only the documented values from the server", () => {
    for (const value of ["email", "console", "off"]) expect(normalizeEmailDelivery(value)).toBe(value)
    for (const value of ["resend", "EMAIL", "memory", "", null, 1, true, {}, ["email"], undefined]) {
      expect(normalizeEmailDelivery(value)).toBeUndefined()
    }
  })

  it("learns the mode from /auth/me and from the forgot-password reply, and forgets a stale one", async () => {
    let delivery: unknown = "email"
    installFetchMock((call) =>
      call.path === "/auth/me" ? ok(meBody({ emailDelivery: delivery })) : ok({ status: "accepted", emailDelivery: delivery }, 202)
    )

    expect((await fetchMe()).emailDelivery).toBe("email")
    expect(mailMode()).toBe("inbox")
    delivery = "something-else"
    expect(await forgotPassword("a@example.org")).toBeUndefined()
    expect(mailMode()).toBe("console") // the development default again, not the stale "inbox"
  })
})

async function requestReset(delivery: unknown, email = "someone@example.org") {
  installFetchMock((call) =>
    call.path === "/auth/forgot-password" ? ok({ status: "accepted", emailDelivery: delivery }, 202) : fail(401, "unauthenticated")
  )
  const view = render(
    <MemoryRouter>
      <AuthProvider>
        <ForgotPasswordPage />
      </AuthProvider>
    </MemoryRouter>
  )
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText("Email"), email)
  await user.click(screen.getByRole("button", { name: "Send reset link" }))
  const status = await screen.findByRole("status")
  return { view, status }
}

describe("ForgotPasswordPage by server mode", () => {
  it.each([true, false])("real e-mail (development=%s): where to look, conditional, and no delivery claim", async (development) => {
    vi.stubEnv("DEV", development)
    const { status } = await requestReset("email")

    expect(status).toHaveTextContent(/^If an account exists for that email address, a password reset link was requested/)
    expect(screen.getByTestId("inbox-reset-hint")).toHaveTextContent(/check your inbox and spam folder/i)
    expect(screen.queryByTestId("dev-reset-hint")).not.toBeInTheDocument()
    expect(status).not.toHaveTextContent(DELIVERY_CLAIM)
    expect(status).not.toHaveTextContent(DEVELOPMENT_TEXT)
    expect(status).not.toHaveTextContent(/resend|provider|api key/i)
  })

  it("real e-mail: the confirmation is identical for every address", async () => {
    const first = await requestReset("email", "exists@example.org")
    const text = first.status.textContent
    first.view.unmount()
    const second = await requestReset("email", "nobody-at-all@example.org")

    expect(second.status.textContent).toBe(text)
    expect(text).not.toContain("@example.org")
  })

  it("development with delivery switched off does not claim the terminal shows a link", async () => {
    const { status } = await requestReset("off")

    expect(status).toHaveTextContent("E-mail delivery is switched off, so no reset link is shown anywhere.")
    expect(status).not.toHaveTextContent(/api terminal|inbox/i)
  })

  it("development with the console backend keeps the terminal wording", async () => {
    const { status } = await requestReset("console")

    expect(status).toHaveTextContent("Development: no e-mail is sent. The reset link is printed in the API terminal.")
    expect(status).not.toHaveTextContent(/inbox/i)
  })

  it.each(["off", "console", "nonsense"])("a production build without a real provider (%s) stays neutral", async (delivery) => {
    vi.stubEnv("DEV", false)
    const { status } = await requestReset(delivery)

    expect(status.textContent).toBe(
      "If an account exists for that email address, a password reset link was requested for it. Reset links expire after one hour."
    )
  })
})

function renderNotice(delivery: EmailDelivery) {
  const mocked = installFetchMock((call) =>
    call.path === "/auth/resend-verification" ? noContent() : ok(meBody({ emailVerified: false, emailDelivery: delivery }))
  )
  render(
    <MemoryRouter>
      <AuthProvider>
        <VerificationNotice />
      </AuthProvider>
    </MemoryRouter>
  )
  return { ...mocked, user: userEvent.setup() }
}

describe("VerificationNotice by server mode", () => {
  it("real e-mail, even in a development build: inbox and spam guidance with the resend button", async () => {
    const { user, calls } = renderNotice("email")

    expect(await screen.findByTestId("inbox-verification-hint")).toHaveTextContent(/check your inbox and spam folder/i)
    expect(screen.queryByTestId("dev-verification-hint")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(DEVELOPMENT_TEXT)

    await user.click(screen.getByRole("button", { name: "Resend verification email" }))

    expect(await screen.findByText(/a new verification link was requested\. check your inbox and spam folder/i)).toBeInTheDocument()
    expect(screen.getByText(/only the newest link works/i)).toBeInTheDocument()
    expect(screen.queryByTestId("inbox-verification-hint")).not.toBeInTheDocument() // said once, not twice
    expect(document.body).not.toHaveTextContent(DELIVERY_CLAIM)
    expect(calls.filter((c) => c.path === "/auth/resend-verification")).toHaveLength(1)
  })

  it("development with delivery switched off keeps the command and drops the terminal claim", async () => {
    const { user } = renderNotice("off")
    const hint = await screen.findByTestId("dev-verification-hint")
    expect(hint).toHaveTextContent(/no e-mail is sent/i)
    expect(hint).toHaveTextContent("dev_verify")
    expect(hint).not.toHaveTextContent(/api terminal/i)

    await user.click(screen.getByRole("button", { name: "Resend verification email" }))

    await waitFor(() => expect(screen.getByText(/nothing is e-mailed in development/i)).toBeInTheDocument())
    expect(document.body).not.toHaveTextContent(/api terminal|inbox/i)
  })
})

describe("copy outside the pages by server mode", () => {
  const notVerified = () => new ApiError({ status: 403, code: "email_not_verified", message: "server text" })

  it("the banner tells a person where to look when mail is real", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthContext.Provider value={authContextValue({ user: testUser({ emailVerified: false, emailDelivery: "email" }) })}>
          <UnverifiedBanner />
        </AuthContext.Provider>
      </MemoryRouter>
    )
    const banner = screen.getByRole("complementary")
    expect(banner).toHaveTextContent(/check your inbox and spam folder for the verification email/i)
    expect(banner).not.toHaveTextContent(DELIVERY_CLAIM)
    expect(banner).not.toHaveTextContent(DEVELOPMENT_TEXT)
  })

  it("the not-verified refusal follows the last mode the server reported", () => {
    rememberEmailDelivery("email")
    const real = userMessageFor(notVerified(), "create-request").description ?? ""
    expect(real).toMatch(/check your inbox and spam folder/i)
    expect(real).not.toMatch(DELIVERY_CLAIM)
    expect(real).not.toMatch(DEVELOPMENT_TEXT)

    rememberEmailDelivery("off")
    vi.stubEnv("DEV", false)
    expect(userMessageFor(notVerified(), "create-request").description).toBe(
      "Verify your email address from your Profile page, then try again."
    )
  })
})
