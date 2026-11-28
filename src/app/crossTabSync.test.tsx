import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useLayoutEffect, useState } from "react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppRoot } from "@/app/ScrollManager"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { useAuth, type AuthContextValue } from "@/hooks/useAuth"
import { resendVerification } from "@/lib/api/auth"
import { getCsrfToken } from "@/lib/api/session"
import { deferred, fail, meBody, ok, type MockReply } from "@/test/apiMock"
import { installFetchMock } from "@/test/apiMock"
import { ADMIN_A, ALICE, BOB, sharedCookieServer, type CookieAccount, type SharedCookieServer } from "@/test/sharedCookieServer"

/**
 * SECURITY (GROCERY-4A): tabs share one cookie, so a change of account in one tab is announced to the
 * others. The announcement carries nothing and proves nothing: a tab that hears it asks the server
 * who it is now, and keeps private screens covered until the server has answered.
 *
 * "Another tab" here is a second `BroadcastChannel` of the same name, which is exactly what another
 * tab is to this one. The cookie is the fake server's.
 */
const CHANNEL = "b17-auth"
const opened: BroadcastChannel[] = []

afterEach(() => {
  opened.splice(0).forEach((channel) => channel.close())
  vi.useRealTimers()
  document.documentElement.removeAttribute("data-identity-check")
})

/** Another tab: everything this app sends is recorded, and it can say that something changed. */
function otherTab() {
  const channel = new BroadcastChannel(CHANNEL)
  opened.push(channel)
  const heard: unknown[] = []
  channel.onmessage = (event) => heard.push(event.data)
  return {
    heard,
    announce: () => channel.postMessage({ type: "b17:auth-changed" }),
    post: (data: unknown) => channel.postMessage(data),
  }
}

/** Messages cross a channel asynchronously: give them time to arrive before looking for none. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 60)))

function Typing() {
  const [text, setText] = useState("")
  return <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
}

function open() {
  const latest: { current: AuthContextValue | null } = { current: null }
  function Probe() {
    const auth = useAuth()
    useLayoutEffect(() => {
      latest.current = auth
    })
    return <p data-testid="who">{`${auth.status}:${auth.user?.displayName ?? "-"}`}</p>
  }
  const router = createMemoryRouter([{ element: <AppRoot />, children: [{ path: "/", element: <Typing /> }] }])
  const view = render(
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <Probe />
      </AuthProvider>
    </ToastProvider>
  )
  const who = (text: string) => waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent(text))
  return {
    view,
    who,
    status: () => screen.getByTestId("who").textContent,
    auth: () => latest.current!,
    user: userEvent.setup(),
    typed: () => screen.getByLabelText("Draft"),
  }
}

async function signedIn(account: CookieAccount) {
  const server = sharedCookieServer(account)
  const app = open()
  await app.who(`authenticated:${account.name}`)
  await app.user.type(app.typed(), "something private")
  return { server, app }
}

const meCalls = (server: SharedCookieServer) => server.calls.filter((call) => call.path === "/auth/me").length
const covered = () => document.documentElement.getAttribute("data-identity-check")
const cover = () => screen.queryByRole("alertdialog")

describe("a change announced by another tab", () => {
  it("signed out there: signed out here, with nothing pressed", async () => {
    const { server, app } = await signedIn(ALICE)
    const other = otherTab()

    server.signInAs(null)
    other.announce()

    await app.who("anonymous:-")
    expect(app.typed()).toHaveValue("")
    expect(cover()).not.toBeInTheDocument()
  })

  it("another account there: this tab becomes theirs and nothing typed is carried over", async () => {
    const { server, app } = await signedIn(ALICE)

    server.signInAs(BOB)
    otherTab().announce()

    await app.who(`authenticated:${BOB.name}`)
    expect(app.typed()).toHaveValue("")
    expect(getCsrfToken()).toBe("csrf-bob-2")
    expect(cover()).not.toBeInTheDocument()
  })

  it("the same account signed in again: the screen is kept, with the new token", async () => {
    const { server, app } = await signedIn(ALICE)

    server.rotateToken()
    otherTab().announce()

    await waitFor(() => expect(getCsrfToken()).toBe("csrf-alice-2"))
    await waitFor(() => expect(cover()).not.toBeInTheDocument())
    expect(app.typed()).toHaveValue("something private")
    expect(covered()).toBeNull()
  })

  it("the page is covered and can't be used until the server has said who this is", async () => {
    const { server, app } = await signedIn(ALICE)
    const answer = deferred<void>()
    server.state.before.set("GET /auth/me", () => answer.promise)

    otherTab().announce()

    await waitFor(() => expect(cover()).toBeInTheDocument())
    expect(cover()).toHaveTextContent(/checking who is signed in/i)
    expect(covered()).toBe("checking")
    expect(app.view.container).toHaveAttribute("inert")
    expect(cover()!.closest("[inert]")).toBeNull()

    await act(async () => answer.resolve())
    await waitFor(() => expect(cover()).not.toBeInTheDocument())
    expect(app.view.container).not.toHaveAttribute("inert")
    expect(app.typed()).toHaveValue("something private")
  })

  it("Escape reaches nothing beneath the cover: an open dialog would close and lose its form", async () => {
    const { server } = await signedIn(ALICE)
    const heard: string[] = []
    // As the dialog library listens: on the document, before anything the cover itself can stop.
    const dialogs = (event: KeyboardEvent) => heard.push(event.key)
    document.addEventListener("keydown", dialogs, { capture: true })
    try {
      const answer = deferred<void>()
      server.state.before.set("GET /auth/me", () => answer.promise)
      otherTab().announce()
      await waitFor(() => expect(cover()).toBeInTheDocument())

      fireEvent.keyDown(cover()!, { key: "Escape" })
      fireEvent.keyDown(document.body, { key: "Escape" })
      expect(heard).toEqual([])

      await act(async () => answer.resolve())
      await waitFor(() => expect(cover()).not.toBeInTheDocument())
      fireEvent.keyDown(document.body, { key: "Escape" })
      expect(heard).toEqual(["Escape"]) // theirs again once the cover is gone
    } finally {
      document.removeEventListener("keydown", dialogs, { capture: true })
    }
  })

  it("with the server out of reach it stays covered, says so, and recovers on request", async () => {
    const server = sharedCookieServer(ALICE)
    const app = open()
    await app.who(`authenticated:${ALICE.name}`)
    await app.user.type(app.typed(), "something private")
    let offline = true
    const gate = () => {
      if (offline) throw new TypeError("Failed to fetch")
    }
    server.state.before.set("GET /auth/me", gate)

    otherTab().announce()

    await waitFor(() => expect(cover()).toHaveTextContent(/couldn.t check who is signed in/i))
    expect(covered()).toBe("unconfirmed")
    expect(app.status()).toBe(`authenticated:${ALICE.name}`) // not mistaken for signed out

    offline = false
    server.signInAs(BOB)
    await app.user.click(screen.getByRole("button", { name: "Try again" }))

    await app.who(`authenticated:${BOB.name}`)
    expect(cover()).not.toBeInTheDocument()
    expect(app.typed()).toHaveValue("")
  })

  it("coming back online checks again by itself", async () => {
    const { server, app } = await signedIn(ALICE)
    server.state.before.set("GET /auth/me", () => {
      throw new TypeError("Failed to fetch")
    })
    otherTab().announce()
    await waitFor(() => expect(covered()).toBe("unconfirmed"))

    act(() => void window.dispatchEvent(new Event("online")))

    await waitFor(() => expect(cover()).not.toBeInTheDocument())
    expect(app.typed()).toHaveValue("something private")
  })

  it("a burst of announcements costs at most one request in flight and one more after it", async () => {
    const { server } = await signedIn(ALICE)
    const before = meCalls(server)
    const answer = deferred<void>()
    server.state.before.set("GET /auth/me", () => answer.promise)
    const other = otherTab()

    other.announce()
    await waitFor(() => expect(meCalls(server)).toBe(before + 1))
    for (let n = 0; n < 20; n += 1) other.announce()
    await settle()
    expect(meCalls(server)).toBe(before + 1)

    await act(async () => answer.resolve())
    await waitFor(() => expect(cover()).not.toBeInTheDocument())
    await settle()
    expect(meCalls(server)).toBe(before + 2)
  })

  it("an announcement is never answered with one, even when it reveals a change (no loops)", async () => {
    const { server, app } = await signedIn(ALICE)
    const other = otherTab()
    await settle()
    other.heard.length = 0

    server.signInAs(BOB)
    other.announce()
    await app.who(`authenticated:${BOB.name}`)
    server.signInAs(null)
    other.announce()
    await app.who("anonymous:-")
    await settle()

    expect(other.heard).toEqual([])
  })

  it("is only a hint: a forged message claiming an account changes nothing", async () => {
    const { app } = await signedIn(ALICE)

    otherTab().post({ type: "b17:auth-changed", user: { id: BOB.id, displayName: BOB.name }, csrfToken: "forged" })
    await settle()

    expect(app.status()).toBe(`authenticated:${ALICE.name}`)
    expect(getCsrfToken()).toBe("csrf-alice-1")
    expect(app.typed()).toHaveValue("something private")
  })

  it("a signed-out visitor's tab is not covered, and keeps what was typed when it learns of a sign-in", async () => {
    const server = sharedCookieServer(null)
    const app = open()
    await app.who("anonymous")
    await app.user.type(app.typed(), "typed as a visitor")
    const answer = deferred<void>()
    server.state.before.set("GET /auth/me", () => answer.promise)

    server.signInAs(ALICE)
    otherTab().announce()
    await settle()
    expect(cover()).not.toBeInTheDocument()

    await act(async () => answer.resolve())
    await app.who(`authenticated:${ALICE.name}`)
    expect(app.typed()).toHaveValue("typed as a visitor")
  })
})

describe("what this tab announces", () => {
  /** A server for the pre-session calls too. */
  function accounts(start: "signed-in" | "anonymous", roles: string[] = [], readBinding?: boolean) {
    let signedInNow = start === "signed-in"
    const me = () => meBody({ roles, ...(readBinding !== undefined && { readBinding }) })
    return installFetchMock((call): MockReply => {
      if (call.path === "/auth/me") return signedInNow ? ok(me()) : fail(401, "unauthenticated")
      if (call.path === "/auth/login") {
        signedInNow = true
        return ok(me())
      }
      if (call.path === "/auth/register") {
        signedInNow = true
        return ok(me(), 201)
      }
      if (call.path === "/auth/logout") {
        signedInNow = false
        return { status: 204 }
      }
      return fail(401, "session_expired")
    })
  }

  const ONE = [{ type: "b17:auth-changed" }]

  it("a page that loads signed in (a reload, or the return from Google sign-in)", async () => {
    const other = otherTab()
    accounts("signed-in")
    const app = open()
    await app.who("authenticated")
    await settle()
    expect(other.heard).toEqual(ONE)
  })

  it("a page that loads signed out announces nothing", async () => {
    const other = otherTab()
    accounts("anonymous")
    const app = open()
    await app.who("anonymous")
    await settle()
    expect(other.heard).toEqual([])
  })

  it.each([
    ["signing in with a password", (auth: AuthContextValue) => auth.login("a@example.org", "pw-for-tests-only")],
    [
      "creating an account",
      (auth: AuthContextValue) => auth.register({ email: "a@example.org", password: "pw-for-tests-only", displayName: "A" }),
    ],
  ])("%s", async (_what, act_) => {
    accounts("anonymous")
    const app = open()
    await app.who("anonymous")
    const other = otherTab()

    await act(async () => void (await act_(app.auth())))
    await settle()

    expect(other.heard).toEqual(ONE)
  })

  it("signing out", async () => {
    accounts("signed-in")
    const app = open()
    await app.who("authenticated")
    await settle()
    const other = otherTab()

    await act(() => app.auth().logout())
    await settle()

    expect(other.heard).toEqual(ONE)
  })

  it("a session found to be over by a request", async () => {
    accounts("signed-in")
    const app = open()
    await app.who("authenticated")
    await settle()
    const other = otherTab()

    await act(async () => void (await resendVerification().catch(() => undefined)))
    await app.who("anonymous")
    await settle()

    expect(other.heard).toEqual(ONE)
  })

  it("a STAFF session refused as too old too, where asking is no staff activity", async () => {
    accounts("signed-in", ["admin"], true)
    const app = open()
    await app.who("authenticated")
    await settle()
    const other = otherTab()

    await act(async () => void (await resendVerification().catch(() => undefined)))
    await app.who("anonymous")
    await settle()

    expect(other.heard).toEqual(ONE)
  })

  it.each([
    ["says nothing", undefined],
    ["says something else", "yes" as unknown as boolean],
  ])("but not on an older server (it %s): another tab asking again would make it fresh", async (_how, readBinding) => {
    accounts("signed-in", ["admin"], readBinding)
    const app = open()
    await app.who("authenticated")
    await settle()
    const other = otherTab()

    await act(async () => void (await resendVerification().catch(() => undefined)))
    await app.who("anonymous")
    await settle()

    expect(other.heard).toEqual([])
  })

  it("never anything but the fact that something changed", async () => {
    const other = otherTab()
    accounts("signed-in")
    const app = open()
    await app.who("authenticated")
    await act(() => app.auth().logout())
    await settle()

    expect(other.heard.length).toBeGreaterThan(0)
    for (const message of other.heard) expect(message).toEqual({ type: "b17:auth-changed" })
    expect(JSON.stringify(other.heard)).not.toMatch(/csrf|ayesha|1111/i)
  })
})

describe("returning to a tab", () => {
  const comeBack = async (afterMs = 60_000) => {
    vi.setSystemTime(Date.now() + afterMs)
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"))
      window.dispatchEvent(new Event("focus"))
    })
    await settle()
  }

  it("asks again who is signed in, once, even with no announcement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { server, app } = await signedIn(ALICE)
    server.signInAs(BOB)
    const before = meCalls(server)

    await comeBack()

    await app.who(`authenticated:${BOB.name}`)
    expect(meCalls(server)).toBe(before + 1)
    expect(app.typed()).toHaveValue("")
  })

  it("doesn't ask again moments after it last did", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { server } = await signedIn(ALICE)
    const before = meCalls(server)

    await comeBack(2_000)

    expect(meCalls(server)).toBe(before)
  })

  it("out of reach, it leaves the screen as it was (nothing says the account changed)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { server, app } = await signedIn(ALICE)
    server.state.before.set("GET /auth/me", () => {
      throw new TypeError("Failed to fetch")
    })

    await comeBack()

    expect(app.status()).toBe(`authenticated:${ALICE.name}`)
    expect(cover()).not.toBeInTheDocument()
    expect(app.typed()).toHaveValue("something private")
  })

  it("a STAFF tab asks too: the current server doesn't count it as staff activity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { server, app } = await signedIn(ADMIN_A)
    server.signInAs(BOB)
    const before = meCalls(server)

    await comeBack()

    await app.who(`authenticated:${BOB.name}`)
    expect(meCalls(server)).toBe(before + 1)
    expect(app.typed()).toHaveValue("")
  })

  it("on an older server a STAFF tab leaves it to the announcements: asking would count as activity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const server = sharedCookieServer(ADMIN_A, undefined, { binds: false })
    const app = open()
    await app.who(`authenticated:${ADMIN_A.name}`)
    const before = meCalls(server)

    await comeBack(3 * 60 * 60_000)

    expect(meCalls(server)).toBe(before)
  })

  it("without BroadcastChannel every tab, staff included, asks on return", async () => {
    vi.stubGlobal("BroadcastChannel", undefined)
    vi.useFakeTimers({ toFake: ["Date"] })
    const { server } = await signedIn(ADMIN_A)
    const before = meCalls(server)

    await comeBack()

    expect(meCalls(server)).toBe(before + 1)
  })

  it("a page restored from the back-forward cache is covered until it has asked", async () => {
    const { server, app } = await signedIn(ADMIN_A)
    const answer = deferred<void>()
    server.state.before.set("GET /auth/me", () => answer.promise)

    act(() => {
      const restored = new Event("pageshow") as PageTransitionEvent
      Object.defineProperty(restored, "persisted", { value: true })
      window.dispatchEvent(restored)
    })

    await waitFor(() => expect(covered()).toBe("checking"))
    await act(async () => answer.resolve())
    await waitFor(() => expect(cover()).not.toBeInTheDocument())
    expect(app.typed()).toHaveValue("something private")
  })
})
