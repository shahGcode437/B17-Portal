import { act, render, screen, waitFor } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { findMember } from "@/features/staff-management/staffData"
import { useAuth, type AuthContextValue } from "@/hooks/useAuth"
import * as adminReads from "@/lib/api/reads/admin"
import * as groceryReads from "@/lib/api/reads/grocery"
import * as settingsReads from "@/lib/api/reads/grocerySettings"
import * as staffOrderReads from "@/lib/api/reads/groceryStaff"
import * as ownerReads from "@/lib/api/reads/owner"
import * as requestReads from "@/lib/api/reads/requests"
import * as savedReads from "@/lib/api/reads/saved"
import * as staffAdminReads from "@/lib/api/reads/staffAdmin"
import { saveListing } from "@/lib/api/writes/saved"
import { getCsrfToken } from "@/lib/api/session"
import { deferred, fail, ok, okPage, type MockReply } from "@/test/apiMock"
import { ALICE, BOB, sharedCookieServer, type CookieAccount, type SharedCookieServer } from "@/test/sharedCookieServer"

/**
 * SECURITY (GROCERY-4A): a private answer is only ever handed to the account the screen belongs to.
 *
 * A server answers a `GET` for whoever the browser's one cookie belongs to. So a tab still showing
 * Alice's screens after another tab signed in as Bob would be given Bob's records. The app names
 * its session on every private read (the current server then refuses any other), AND confirms every
 * answer itself, so that an older server, which ignores the name, can't expose anything either.
 * Every answer here names whose data it is.
 */
const SERVERS = [
  ["the current server, which binds reads to the named session", true],
  ["an older server, which ignores the name", false],
] as const
const ID = "99999999-0000-4000-8000-000000000001"

/** One body that every reader accepts, naming the account the server answered for. */
const record = (actor: CookieAccount) => ({
  owner: actor.name,
  id: ID,
  availableActions: [],
  revision: 1,
  enabled: false,
  serviceableBlocks: [],
  operatingDays: [],
})
const recordsOf = (call: { path: string }, actor: CookieAccount): MockReply =>
  /^\/(saved|requests|users\/me\/leads|users\/me\/listings|admin\/listings|grocery\/orders|admin\/grocery\/orders|admin\/staff|admin\/audit)$/.test(
    call.path
  )
    ? okPage([record(actor)], { counts: {} })
    : ok(record(actor))

type Read = [module: string, name: string, call: () => Promise<unknown>]

const READS: Read[] = [
  ["admin", "fetchAdminQueue", () => adminReads.fetchAdminQueue()],
  ["admin", "fetchAdminListing", () => adminReads.fetchAdminListing(ID)],
  ["admin", "fetchAdminCategories", () => adminReads.fetchAdminCategories()],
  ["grocery", "fetchMyGroceryOrders", () => groceryReads.fetchMyGroceryOrders()],
  ["grocery", "fetchMyGroceryOrder", () => groceryReads.fetchMyGroceryOrder(ID)],
  ["grocerySettings", "fetchGrocerySettings", () => settingsReads.fetchGrocerySettings()],
  ["groceryStaff", "fetchGroceryQueue", () => staffOrderReads.fetchGroceryQueue({})],
  ["groceryStaff", "fetchGroceryStaffOrder", () => staffOrderReads.fetchGroceryStaffOrder(ID)],
  ["owner", "fetchOwnerListings", () => ownerReads.fetchOwnerListings()],
  ["owner", "fetchOwnerListing", () => ownerReads.fetchOwnerListing(ID)],
  ["requests", "fetchMyRequests", () => requestReads.fetchMyRequests()],
  ["requests", "fetchRequest", () => requestReads.fetchRequest(ID)],
  ["requests", "fetchLeads", () => requestReads.fetchLeads()],
  ["saved", "fetchSaved", () => savedReads.fetchSaved()],
  ["staffAdmin", "fetchStaffRoster", () => staffAdminReads.fetchStaffRoster({})],
  ["staffAdmin", "fetchStaffAudit", () => staffAdminReads.fetchStaffAudit({})],
]

/** The real auth layer (it is what the API client asks who is signed in), with a probe on its state. */
async function signedInAs(name: string) {
  const latest: { current: AuthContextValue | null } = { current: null }
  function Probe() {
    const auth = useAuth()
    useLayoutEffect(() => {
      latest.current = auth
    })
    return <p data-testid="who">{`${auth.status}:${auth.user?.displayName ?? "-"}`}</p>
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  const who = (text: string) => waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent(text))
  await who(`authenticated:${name}`)
  return {
    who,
    user: () => latest.current!.user,
    status: () => screen.getByTestId("who").textContent,
    reread: () => act(async () => void (await latest.current!.refreshMe({ fresh: true }))),
  }
}

/** What the caller received: the data, or the error it was refused with. */
async function outcome(run: () => Promise<unknown>) {
  let result: { data: unknown } | { error: unknown } | null = null
  await act(async () => {
    result = await run().then(
      (data) => ({ data }),
      (error: unknown) => ({ error })
    )
  })
  return result! as { data?: unknown; error?: unknown }
}

const names = (value: unknown) => JSON.stringify(value ?? null)
const meCalls = (server: SharedCookieServer) => server.calls.filter((call) => call.path === "/auth/me").length

describe("every private read names the session it means", () => {
  it.each(READS)("%s.%s sends this tab's token", async (_m, _n, read) => {
    const server = sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)

    await outcome(read)

    const sent = server.calls.filter((call) => call.path !== "/auth/me")
    expect(sent.map((call) => call.headers.get("X-CSRF-Token"))).toEqual(["csrf-alice-1"])
  })

  it("asking who is signed in names none", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)
    await outcome(() => requestReads.fetchMyRequests())
    for (const call of server.calls.filter((c) => c.path === "/auth/me")) {
      expect(call.headers.get("X-CSRF-Token")).toBeNull()
    }
  })
})

describe.each(SERVERS)("another account signed in before the read was sent (%s)", (_which, binds) => {
  it.each(READS)("%s.%s: nothing of theirs reaches the caller, and the tab learns who it is", async (_m, _n, read) => {
    const server = sharedCookieServer(ALICE, recordsOf, { binds })
    const app = await signedInAs(ALICE.name)
    server.signInAs(BOB) // another tab; this one has not been told

    const result = await outcome(read)

    expect(names(result.data)).not.toContain(BOB.name)
    expect(result.error).toMatchObject({ code: "session_changed" })
    await app.who(`authenticated:${BOB.name}`)
  })
})

describe.each(SERVERS)("the account changed while the answer was on its way (%s)", (_which, binds) => {
  it.each(READS)("%s.%s: an answer for the earlier account is dropped too", async (_m, _n, read) => {
    const held = deferred<void>()
    let hold = true
    const server = sharedCookieServer(ALICE, async (call, actor) => {
      const reply = recordsOf(call, actor) // decided as Alice
      if (hold) await held.promise
      return reply
    }, { binds })
    await signedInAs(ALICE.name)

    const pending = read().then(
      (data) => ({ data }) as { data?: unknown; error?: unknown },
      (error: unknown) => ({ error }) as { data?: unknown; error?: unknown }
    )
    server.signInAs(BOB)
    hold = false
    await act(async () => held.resolve())
    const result = await act(() => pending)

    expect(result.data).toBeUndefined()
    expect(result.error).toMatchObject({ code: "session_changed" })
  })
})

describe.each(SERVERS)("the same session (%s)", (_which, binds) => {
  it.each(READS)("%s.%s: the answer is handed over, confirmed by one request made after it", async (_m, _n, read) => {
    const server = sharedCookieServer(ALICE, recordsOf, { binds })
    await signedInAs(ALICE.name)
    const before = meCalls(server)

    const result = await outcome(read)

    expect(result.error).toBeUndefined()
    expect(names(result.data)).toContain(ALICE.name)
    expect(meCalls(server)).toBe(before + 1)
    const paths = server.calls.map((call) => call.path)
    expect(paths.lastIndexOf("/auth/me")).toBe(paths.length - 1)
  })

  it("a renewed session for the same account: refused once, then the next read works", async () => {
    const server = sharedCookieServer(ALICE, recordsOf, { binds })
    const app = await signedInAs(ALICE.name)
    server.rotateToken()

    expect((await outcome(() => requestReads.fetchMyRequests())).error).toMatchObject({ code: "session_changed" })
    await waitFor(() => expect(getCsrfToken()).toBe("csrf-alice-2"))
    expect(app.status()).toBe(`authenticated:${ALICE.name}`)

    expect(names((await outcome(() => requestReads.fetchMyRequests())).data)).toContain(ALICE.name)
  })

  it("reads that finish together share the confirming requests", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)
    const before = meCalls(server)

    await act(async () => void (await Promise.all(Array.from({ length: 6 }, () => requestReads.fetchMyRequests()))))

    // One already on its way cannot confirm an answer that arrived after it left: at most one more follows.
    expect(meCalls(server) - before).toBeLessThanOrEqual(2)
  })
})

describe("an older browser", () => {
  it("reads work without AbortSignal.timeout (added in Safari 16)", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new TypeError("AbortSignal.timeout is not a function")
    })
    sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)

    expect(names((await outcome(() => requestReads.fetchMyRequests())).data)).toContain(ALICE.name)
  })
})

describe("when it can't be confirmed", () => {
  it("a confirmation that never answers is given up on, and nothing is handed over", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)
    server.state.before.set("GET /auth/me", () => new Promise<void>(() => {}))
    // As a real `fetch` does, give up when told to (the shared fake doesn't watch the signal).
    const answering = globalThis.fetch
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      Promise.race([
        answering(input, init),
        new Promise<never>((_yes, no) =>
          init?.signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError")))
        ),
      ])
    )
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const pending = requestReads.fetchMyRequests().then(
        () => "handed over",
        (error: unknown) => error
      )
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      await expect(pending).resolves.toMatchObject({ status: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("nothing is handed over, and an unreachable check doesn't sign the person out", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    const app = await signedInAs(ALICE.name)
    server.state.before.set("GET /auth/me", () => {
      throw new TypeError("Failed to fetch")
    })

    const result = await outcome(() => requestReads.fetchMyRequests())

    expect(result.data).toBeUndefined()
    expect(result.error).toMatchObject({ status: 0 })
    expect(app.status()).toBe(`authenticated:${ALICE.name}`)
  })

  it("signed out elsewhere: the read is refused and this tab signs out", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    const app = await signedInAs(ALICE.name)
    server.signInAs(null)

    expect((await outcome(() => requestReads.fetchMyRequests())).error).toMatchObject({ status: 401 })
    await app.who("anonymous:-")
  })
})

describe("only a confirmation sent after the answer arrived counts", () => {
  it("one already on its way cannot confirm a later answer", async () => {
    const server = sharedCookieServer(ALICE, recordsOf)
    await signedInAs(ALICE.name)
    // The first confirmation is answered (as Alice) straight away, but arrives late.
    const arrival = deferred<void>()
    let holdNext = true
    const answering = globalThis.fetch
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await answering(input, init)
      if (holdNext && String(input).endsWith("/auth/me")) {
        holdNext = false
        await arrival.promise
      }
      return response
    })
    const before = meCalls(server)

    const first = requestReads.fetchMyRequests().catch(() => undefined)
    await waitFor(() => expect(meCalls(server)).toBe(before + 1))
    server.signInAs(BOB)
    const second = requestReads.fetchLeads().then(
      (data) => ({ data }) as { data?: unknown; error?: unknown },
      (error: unknown) => ({ error }) as { data?: unknown; error?: unknown }
    )
    await waitFor(() => expect(server.calls.some((call) => call.path === "/users/me/leads")).toBe(true))
    await act(() => new Promise((done) => setTimeout(done, 20)))
    await act(async () => arrival.resolve())
    await act(async () => void (await first))
    const result = await act(() => second)

    expect(result.data).toBeUndefined() // it was Bob's
    expect(result.error).toMatchObject({ code: "session_changed" })
  })

  it("confirming changes nothing the screens read when the account is the same", async () => {
    sharedCookieServer(ALICE, recordsOf)
    const app = await signedInAs(ALICE.name)
    const user = app.user()

    await outcome(() => requestReads.fetchMyRequests())
    await app.reread()

    // The same object, so nothing that depends on it loads again.
    expect(app.user()).toBe(user)
  })
})

describe("a late refusal that belongs to an earlier session", () => {
  const refusals: [string, MockReply][] = [
    ["session_expired", fail(401, "session_expired")],
    ["unauthenticated", fail(401, "unauthenticated")],
    ["account_disabled", fail(403, "account_disabled")],
  ]

  it.each(refusals)("%s on a read never ends the newer session", async (_code, refusal) => {
    const held = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, () => held.promise)
    const app = await signedInAs(ALICE.name)
    const pending = requestReads.fetchMyRequests().catch(() => undefined)

    server.signInAs(BOB)
    await app.reread()
    await app.who(`authenticated:${BOB.name}`)
    await act(async () => {
      held.resolve(refusal)
      await pending
    })

    expect(app.status()).toBe(`authenticated:${BOB.name}`)
    expect(getCsrfToken()).toBe("csrf-bob-2")
  })

  it.each(refusals)("%s on a change never ends the newer session", async (_code, refusal) => {
    const held = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, () => held.promise)
    const app = await signedInAs(ALICE.name)
    const pending = saveListing(ID).catch(() => undefined)

    server.signInAs(BOB)
    await app.reread()
    await app.who(`authenticated:${BOB.name}`)
    await act(async () => {
      held.resolve(refusal)
      await pending
    })

    expect(app.status()).toBe(`authenticated:${BOB.name}`)
    expect(getCsrfToken()).toBe("csrf-bob-2")
  })
})

describe("a read made of several requests", () => {
  const member = (n: number, actor: CookieAccount) => ({ userId: `member-${n}`, owner: actor.name })

  it("never mixes two accounts' pages", async () => {
    let pages = 0
    const gate = deferred<void>()
    const server = sharedCookieServer(ALICE, async (_call, actor) => {
      pages += 1
      if (pages === 2) await gate.promise
      return okPage([member(pages, actor)], { total: 300, limit: 100 })
    })
    const app = await signedInAs(ALICE.name)
    const looking = findMember("member-3").then(
      (found) => ({ found }) as { found?: unknown; error?: unknown },
      (error: unknown) => ({ error }) as { found?: unknown; error?: unknown }
    )
    await waitFor(() => expect(pages).toBe(2))

    server.signInAs(BOB)
    await app.reread()
    await act(async () => gate.resolve())
    const result = await act(() => looking)

    expect(result.found).toBeUndefined()
    expect(result.error).toMatchObject({ code: "session_changed" })
    expect(pages).toBe(2) // it stopped: no further page was asked for as the new account
  })
})

describe("a cookie that changes back before the confirmation", () => {
  /** Bob holds the cookie while the read is answered; Alice's is back before anything can check. */
  async function readWhileBobHoldsTheCookie(binds: boolean) {
    const server = sharedCookieServer(ALICE, recordsOf, { binds })
    await signedInAs(ALICE.name)
    const alice = { ...server.state }
    server.signInAs(BOB)
    server.state.before.set("GET /auth/me", () => void Object.assign(server.state, alice))
    return outcome(() => requestReads.fetchMyRequests())
  }

  it("changes nothing with the current server: it never answers a session the tab didn't name", async () => {
    const result = await readWhileBobHoldsTheCookie(true)
    expect(names(result.data)).not.toContain(BOB.name)
    expect(result.error).toMatchObject({ code: "session_changed" })
  })

  it("is the limit of an OLDER server: the confirmation alone would accept it", async () => {
    // Unreachable by signing in (every sign-in makes a new session); it needed a late response re-setting
    // the old cookie, which the current server never does. Recorded so nobody relies on the older one.
    const result = await readWhileBobHoldsTheCookie(false)
    expect(names(result.data)).toContain(BOB.name)
  })
})

describe("the list above is every private read", () => {
  const PRIVATE_MODULES: [string, object][] = [
    ["admin", adminReads],
    ["grocery", groceryReads],
    ["grocerySettings", settingsReads],
    ["groceryStaff", staffOrderReads],
    ["owner", ownerReads],
    ["requests", requestReads],
    ["saved", savedReads],
    ["staffAdmin", staffAdminReads],
  ]
  const sources = import.meta.glob("/src/lib/api/reads/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >

  it("covers every module that reads with a session", () => {
    const withSession = Object.entries(sources)
      .filter(([path, source]) => !path.endsWith(".test.ts") && /session:\s*true/.test(source))
      .map(([path]) => path.split("/").pop()!.replace(".ts", ""))
    expect(withSession.sort()).toEqual(PRIVATE_MODULES.map(([name]) => name).sort())
  })

  it("covers every function of those modules, apart from the named public and helper ones", () => {
    const notPrivate = new Set(["grocery.fetchGroceryAvailability", "grocerySettings.checkedSettings"])
    const exported = PRIVATE_MODULES.flatMap(([module, functions]) =>
      Object.entries(functions)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => `${module}.${name}`)
    ).filter((name) => !notPrivate.has(name))
    expect(READS.map(([module, name]) => `${module}.${name}`).sort()).toEqual(exported.sort())
  })

  it("sends every one of them as a session read", async () => {
    // A private read left without `session: true` would be neither confirmed nor cleared on sign-out.
    for (const [module] of PRIVATE_MODULES) {
      const source = sources[`/src/lib/api/reads/${module}.ts`]
      const requests = source.match(/apiRequest\w*(<[^>]*>)?>?\(\s*"GET"/g)?.length ?? 0
      const sessions = source.match(/session:\s*true/g)?.length ?? 0
      expect(sessions, module).toBe(module === "grocery" ? requests - 1 : requests)
    }
  })
})
