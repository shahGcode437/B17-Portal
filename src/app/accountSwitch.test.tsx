import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useLayoutEffect, useState, type ReactElement } from "react"
import { RouterProvider, createMemoryRouter, useNavigate, type RouteObject } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { ACCOUNT_CHANGED_MESSAGE, SESSION_ENDED_MESSAGE } from "@/app/AccountBoundary"
import { AppRoot } from "@/app/ScrollManager"
import { AuthGate } from "@/components/access/AuthGate"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { SaveButton } from "@/components/inputs/SaveButton"
import { AdminCategoriesPage } from "@/features/admin/AdminCategoriesPage"
import { ReviewPanel } from "@/features/admin/ReviewPanel"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { GroceryDraftSession } from "@/features/grocery/GroceryDraftSession"
import { GroceryReviewPage } from "@/features/grocery/GroceryReviewPage"
import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { EMPTY_DELIVERY } from "@/features/grocery/orderRequest"
import { ACTION_DONE } from "@/features/grocery-staff/staffLabels"
import { useStaffOrderWrite } from "@/features/grocery-staff/useStaffOrderWrite"
import { getCsrfToken } from "@/lib/api/session"
import { claimGroceryOrder } from "@/lib/api/writes/groceryStaff"
import { saveListing } from "@/lib/api/writes/saved"
import { useAuth, type AuthContextValue } from "@/hooks/useAuth"
import { useGuardedWrite } from "@/hooks/useGuardedWrite"
import { useMutation } from "@/hooks/useMutation"
import { useToast } from "@/hooks/useToast"
import { _resetSavedSetForTests } from "@/hooks/useSavedSet"
import { routes } from "@/config/routes"
import { deferred, fail, ok, okPage, type MockReply } from "@/test/apiMock"
import { GroceryBackend, TEST_BLOCKS } from "@/test/fixtures/groceryBackend"
import { ADMIN_A, ADMIN_B, ALICE, BOB, sharedCookieServer, type Answer, type CookieAccount } from "@/test/sharedCookieServer"
import type { AdminQueueRow } from "@/types/ownerListing"

/**
 * SECURITY: what the app does when the account in the browser changes under an open screen. Real
 * auth provider, real app root, real screens; the fake server keeps one cookie for all of them.
 * Every step is explicit (a held answer, a called function): nothing depends on timing.
 */
const draft = () => useGroceryDraft.getState()

beforeEach(() => {
  draft().reset()
  _resetSavedSetForTests()
})

/** The app as it mounts: auth provider around the router, `AppRoot` above every page. */
function renderApp(path: string, routesUnderRoot: RouteObject[]) {
  const latest: { current: AuthContextValue | null } = { current: null }
  function Probe() {
    const auth = useAuth()
    useLayoutEffect(() => {
      latest.current = auth
    })
    return <p data-testid="who">{`${auth.status}:${auth.user?.displayName ?? "-"}`}</p>
  }
  const router = createMemoryRouter(
    [{ element: <AppRoot />, children: [...routesUnderRoot, { path: "*", element: <p>elsewhere</p> }] }],
    { initialEntries: [path] }
  )
  render(
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <GroceryDraftSession />
        <Probe />
      </AuthProvider>
    </ToastProvider>
  )
  const who = (text: string) => waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent(text))
  /** This tab reads `/auth/me` again (as it does on returning to a staff screen, or after a refusal). */
  const reread = () => act(async () => void (await latest.current!.refreshMe({ fresh: true })))
  return { user: userEvent.setup(), router, who, reread, auth: () => latest.current! }
}

const signedIn = (who: CookieAccount) => `authenticated:${who.name}`
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe("the customer's grocery order", () => {
  function groceryServer() {
    const backend = new GroceryBackend()
    const answer: Answer = (call, actor) =>
      backend.route(
        call.method,
        call.path,
        new URL(call.url, "http://test.invalid").searchParams,
        call.body,
        call.headers.get("Idempotency-Key"),
        { key: actor.name, emailVerified: true }
      ) as MockReply
    return { backend, answer }
  }

  async function aliceAtReview(server: ReturnType<typeof sharedCookieServer>) {
    // The review page sends an empty list elsewhere, so the list is written first.
    const app = renderApp("/start", [
      { path: "/start", element: <p>start</p> },
      { path: routes.groceryReview, element: <GroceryReviewPage /> },
    ])
    await app.who(signedIn(ALICE))
    await waitFor(() => expect(draft().ownerId).toBe(server.state.account!.id))
    act(() => {
      draft().addItem({ name: "Basmati rice", quantity: "5", unit: "kg", preferredBrand: "", substitution: "ask", note: "" })
      draft().setDelivery({
        ...EMPTY_DELIVERY,
        contactName: "Alice Private Name",
        contactPhone: "0300 1234567",
        block: TEST_BLOCKS[0],
        addressLine: "Alice's Private House 17",
      })
    })
    await act(() => app.router.navigate(routes.groceryReview))
    await screen.findByRole("button", { name: "Send my order" })
    return app
  }

  const orders = (backend: GroceryBackend) => backend.orders.map((o) => `${o.owner}: ${o.detail.delivery.contactName}`)

  it("is never created for another account that signed in before Send was pressed", async () => {
    const { backend, answer } = groceryServer()
    const server = sharedCookieServer(ALICE, answer)
    const app = await aliceAtReview(server)

    server.signInAs(BOB) // another tab
    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    await app.who(signedIn(BOB))
    await settle()

    expect(orders(backend)).toEqual([])
    expect(server.attempts()).toHaveLength(1)
    // None of Alice's list or delivery details is left for Bob to see or send.
    expect(draft().items).toEqual([])
    expect(document.body).not.toHaveTextContent("Alice Private Name")
    expect(document.body).not.toHaveTextContent("Private House")
  })

  it("an order still on its way when another account signs in: its answer reaches nothing of theirs", async () => {
    const { backend, answer } = groceryServer()
    const held = deferred<void>()
    const server = sharedCookieServer(ALICE, async (call, actor) => {
      const reply = await answer(call, actor) // stored as Alice's, as she asked
      if (call.method === "POST") await held.promise
      return reply
    })
    const app = await aliceAtReview(server)
    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    await waitFor(() => expect(orders(backend)).toHaveLength(1))

    server.signInAs(BOB)
    await app.reread()
    await act(async () => held.resolve())
    await settle()

    expect(orders(backend)).toEqual([`${ALICE.name}: Alice Private Name`])
    expect(draft()).toMatchObject({ ownerId: BOB.id, items: [], attempt: null, sentOrderId: null, phase: "idle" })
    expect(app.router.state.location.pathname).not.toContain(backend.orders[0].detail.id)
    expect(document.body).not.toHaveTextContent("Alice Private Name")
  })

  it("logging out while an order is on its way clears it, and the late answer brings nothing back", async () => {
    const { backend, answer } = groceryServer()
    const held = deferred<void>()
    const server = sharedCookieServer(ALICE, async (call, actor) => {
      const reply = await answer(call, actor)
      if (call.method === "POST") await held.promise
      return reply
    })
    const app = await aliceAtReview(server)
    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    await waitFor(() => expect(orders(backend)).toHaveLength(1))

    await act(() => app.auth().logout())
    await act(async () => held.resolve())
    await settle()

    expect(draft()).toMatchObject({ ownerId: null, items: [], attempt: null, sentOrderId: null, phase: "idle" })
    expect(document.body).not.toHaveTextContent("Alice Private Name")
    expect(server.attempts().map((call) => call.path)).toEqual(["/grocery/orders", "/auth/logout"])
  })

  it("with the same account's token renewed: refused, kept, and one order when sent again", async () => {
    const { backend, answer } = groceryServer()
    const server = sharedCookieServer(ALICE, answer)
    const app = await aliceAtReview(server)
    server.rotateToken()

    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/secure session/i)
    expect(orders(backend)).toEqual([])
    expect(draft().items).toHaveLength(1)
    expect(document.body).toHaveTextContent("Alice Private Name")

    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    await waitFor(() => expect(orders(backend)).toEqual([`${ALICE.name}: Alice Private Name`]))
    expect(server.attempts()).toHaveLength(2)
  })

  it("an unconfirmed order stays idempotent across a token renewal: the same key, one order", async () => {
    const { backend, answer } = groceryServer()
    let lose = true
    const server = sharedCookieServer(ALICE, async (call, actor) => {
      const reply = await answer(call, actor)
      if (lose && call.method === "POST") {
        lose = false
        return "network-error" // stored, but the answer never arrived
      }
      return reply
    })
    const app = await aliceAtReview(server)
    await app.user.click(screen.getByRole("button", { name: "Send my order" }))
    const again = await screen.findByRole("button", { name: "Send the same order again" })
    server.rotateToken()

    await app.user.click(again) // refused before the server looks at the key: still unknown
    await waitFor(() => expect(server.attempts()).toHaveLength(2))
    await settle()
    expect(draft().phase).toBe("unconfirmed")

    await app.user.click(await screen.findByRole("button", { name: "Send the same order again" }))
    await waitFor(() => expect(draft().phase).toBe("idle"))
    const keys = server.attempts().map((call) => call.headers.get("Idempotency-Key"))
    expect(new Set(keys).size).toBe(1)
    expect(orders(backend)).toHaveLength(1)
  })
})

describe("listing moderation", () => {
  const ROW: AdminQueueRow = {
    id: "00000000-0000-4000-8000-0000000000a1",
    kind: "provider",
    title: "Imran Electrical Works",
    typeLabel: "Service",
    categoryLabel: "Electrical",
    area: "B-17",
    locationVisibility: "area_only",
    status: "pending",
    revision: 1,
    submittedAt: "2026-10-05T08:00:00Z",
  }
  const DETAIL = {
    id: ROW.id,
    kind: "provider",
    name: ROW.title,
    area: "B-17",
    tags: [],
    status: "pending",
    revision: 1,
    description: "Described by the owner.",
    category: "electrical",
    categoryLabel: "Electrical",
    categories: [{ slug: "electrical", name: "Electrical", isPrimary: true }],
    location: { visibility: "area_only" },
    publicLocation: { visibility: "area_only" },
    submittedAt: "2026-10-05T08:00:00Z",
    createdAt: "2026-10-05T08:00:00Z",
    updatedAt: "2026-10-06T08:00:00Z",
    submitter: { displayName: "Sana Owner" },
    history: [],
  }

  function Host(): ReactElement {
    const [open, setOpen] = useState(true)
    return <ReviewPanel row={ROW} open={open} onOpenChange={setOpen} onChanged={() => {}} />
  }

  it("an approval pressed after another administrator signed in is not made in their name", async () => {
    const server = sharedCookieServer(ADMIN_A, (call) => (call.method === "GET" ? ok(DETAIL) : ok({ ...DETAIL, status: "approved" })))
    const app = renderApp("/admin/moderation", [
      { element: <AuthGate requires="admin" />, children: [{ path: "/admin/moderation", element: <Host /> }] },
    ])
    const approve = await screen.findByRole("button", { name: /^approve/i })
    await waitFor(() => expect(approve).toBeEnabled())

    server.signInAs(ADMIN_B)
    await app.user.click(approve)
    await app.who(signedIn(ADMIN_B))
    await settle()

    expect(server.performed).toEqual([])
    expect(server.attempts()).toHaveLength(1)
  })
})

describe("what one account typed never stays for the next", () => {
  const categories = (server: ReturnType<typeof sharedCookieServer>) => server.performed.map((p) => p.actor)

  const ONE = [{ id: "c0", module: "services", name: "Electrical", slug: "electrical", isActive: true, displayOrder: 1 }]

  async function openForm() {
    const server = sharedCookieServer(ADMIN_A, (call) => (call.method === "GET" ? ok(ONE) : ok(ONE[0], 201)))
    const app = renderApp(routes.adminCategories, [
      { element: <AuthGate requires="admin" />, children: [{ path: routes.adminCategories, element: <AdminCategoriesPage /> }] },
    ])
    await app.user.click(await screen.findByRole("button", { name: "Add a Services category" }))
    await app.user.type(screen.getByLabelText("New Services category name"), "Alice's draft category")
    return { server, app }
  }

  it("after a refused change, the other account is not shown the form, and cannot send it", async () => {
    const { server, app } = await openForm()
    server.signInAs(ADMIN_B)

    await app.user.click(screen.getByRole("button", { name: "Add" }))
    await app.who(signedIn(ADMIN_B))
    await settle()

    expect(categories(server)).toEqual([])
    expect(screen.queryByDisplayValue("Alice's draft category")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument()
  })

  it("the same account keeps what it typed through a token renewal, and sends it itself", async () => {
    const { server, app } = await openForm()
    server.rotateToken()

    await app.user.click(screen.getByRole("button", { name: "Add" }))
    await screen.findByText(/secure session/i)
    expect(screen.getByLabelText("New Services category name")).toHaveValue("Alice's draft category")
    expect(categories(server)).toEqual([])

    await app.user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(categories(server)).toEqual([ADMIN_A.name]))
    expect(server.attempts()).toHaveLength(2)
  })

  /** Any screen with something typed into it. */
  function Typing() {
    const [text, setText] = useState("")
    return <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
  }
  const typed = () => screen.getByLabelText("Draft")

  async function typing(first: CookieAccount | null) {
    const server = sharedCookieServer(first)
    const app = renderApp("/open", [{ path: "/open", element: <Typing /> }])
    await app.who(first ? signedIn(first) : "anonymous")
    await app.user.type(typed(), "something private")
    return { server, app }
  }

  it("a different account replaces the screen, and says why", async () => {
    const { server, app } = await typing(ALICE)
    server.signInAs(BOB)
    await app.reread()
    expect(typed()).toHaveValue("")
    expect(await screen.findByText(ACCOUNT_CHANGED_MESSAGE)).toBeInTheDocument()
  })

  it("the previous screen is already gone the moment the new account's token exists", async () => {
    const { server, app } = await typing(ALICE)
    server.signInAs(BOB)
    // As in a browser: React draws when it chooses to, not when `act` ends.
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const wasActing = scope.IS_REACT_ACT_ENVIRONMENT
    scope.IS_REACT_ACT_ENVIRONMENT = false
    try {
      await app.auth().refreshMe({ fresh: true })
      // No waiting at all: nothing can run between these two lines and the answer being applied.
      expect(getCsrfToken()).toBe("csrf-bob-2")
      expect(typed()).toHaveValue("")
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = wasActing
    }
  })

  it("an ended session replaces the screen", async () => {
    const { server, app } = await typing(ALICE)
    server.signInAs(null)
    await app.reread()
    expect(typed()).toHaveValue("")
    expect(screen.queryByText(ACCOUNT_CHANGED_MESSAGE)).not.toBeInTheDocument()
  })

  it("the same account keeps its screen, with a new token too", async () => {
    const { server, app } = await typing(ALICE)
    server.rotateToken()
    await app.reread()
    expect(typed()).toHaveValue("something private")
  })

  it("what a signed-out visitor typed stays when they sign in", async () => {
    const { server, app } = await typing(null)
    server.signInAs(ALICE)
    await app.reread()
    await app.who(signedIn(ALICE))
    expect(typed()).toHaveValue("something private")
    expect(screen.queryByText(ACCOUNT_CHANGED_MESSAGE)).not.toBeInTheDocument()
  })

  it("a server that can't be reached for a moment changes nothing; another account afterwards does", async () => {
    const { server, app } = await typing(ALICE)
    server.state.before.set("GET /auth/me", () => {
      throw new TypeError("Failed to fetch")
    })
    await app.reread()
    await app.who("unavailable")
    expect(typed()).toHaveValue("something private")

    server.signInAs(BOB)
    await app.reread()
    expect(typed()).toHaveValue("")
  })
})

describe("a change answered after the account changed", () => {
  /** The shape of every form that moves on after saving: await the change, say so, go elsewhere. */
  function SavesThenMoves() {
    const save = useMutation(saveListing)
    const navigate = useNavigate()
    const { show } = useToast()
    const submit = async () => {
      try {
        await save.mutate("00000000-0000-4000-8000-000000000101")
        show("Saved for Alice")
        navigate("/moved-on")
      } catch {
        show("It was not saved", { tone: "error" })
      }
    }
    return <button onClick={() => void submit()}>Save it</button>
  }

  async function pressed() {
    const answer = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, () => answer.promise)
    const app = renderApp("/open", [
      { path: "/open", element: <SavesThenMoves /> },
      { path: "/moved-on", element: <p>moved on</p> },
    ])
    await app.who(signedIn(ALICE))
    await app.user.click(screen.getByRole("button", { name: "Save it" }))
    await waitFor(() => expect(server.attempts()).toHaveLength(1))
    return { answer, server, app }
  }

  it("a success runs nothing of what would have followed", async () => {
    const { answer, server, app } = await pressed()
    server.signInAs(BOB)
    await app.reread()
    await act(async () => answer.resolve({ status: 204 }))
    await settle()

    expect(app.router.state.location.pathname).toBe("/open")
    expect(screen.queryByText("Saved for Alice")).not.toBeInTheDocument()
  })

  it("with nobody else signed in, what follows still happens", async () => {
    const { answer, server, app } = await pressed()
    server.rotateToken() // the same account, signed in again elsewhere
    await app.reread()
    await act(async () => answer.resolve({ status: 204 }))

    await waitFor(() => expect(app.router.state.location.pathname).toBe("/moved-on"))
    expect(await screen.findByText("Saved for Alice")).toBeInTheDocument()
  })
})

describe("the staff and administration write hooks", () => {
  const ORDER_ID = "00000000-0000-4000-8000-0000000000c1"
  const ORDER = { id: ORDER_ID, availableActions: [] } as never
  const nothing = () => {}

  function StaffClaim() {
    const write = useStaffOrderWrite({
      userId: ALICE.id,
      orderId: ORDER_ID,
      order: ORDER,
      replace: nothing,
      reload: nothing,
      closeDialog: nothing,
    })
    return <button onClick={() => void write.run("claim", (signal) => claimGroceryOrder(ORDER_ID, signal))}>Do it</button>
  }

  function AdminChange() {
    const { show } = useToast()
    const write = useGuardedWrite<object>({
      lockKey: "account-switch-test",
      snapshot: ORDER,
      reload: nothing,
      closeDialog: nothing,
      isBehind: () => false,
      explain: () => ({ title: "", description: "" }),
    })
    return (
      <button onClick={() => void write.run("it", (signal) => claimGroceryOrder(ORDER_ID, signal), () => show("Admin change saved"))}>
        Do it
      </button>
    )
  }

  const HOOKS: [string, () => ReactElement, string][] = [
    ["a grocery staff action", StaffClaim, ACTION_DONE.claim],
    ["an administrative change", AdminChange, "Admin change saved"],
  ]

  async function pressed(Screen: () => ReactElement) {
    const answer = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, () => answer.promise)
    const app = renderApp("/open", [{ path: "/open", element: <Screen /> }])
    await app.who(signedIn(ALICE))
    await app.user.click(screen.getByRole("button", { name: "Do it" }))
    await waitFor(() => expect(server.attempts()).toHaveLength(1))
    const succeed = () => act(async () => answer.resolve(ok({ id: ORDER_ID, availableActions: [] })))
    return { server, app, succeed }
  }

  it.each(HOOKS)("%s answered after another account signed in says nothing to them", async (_what, Screen, said) => {
    const { server, app, succeed } = await pressed(Screen)
    server.signInAs(BOB)
    await app.reread()
    await succeed()
    await settle()

    expect(screen.queryByText(said)).not.toBeInTheDocument()
  })

  it.each(HOOKS)("%s answered to the same account is reported as usual", async (_what, Screen, said) => {
    const { succeed } = await pressed(Screen)
    await succeed()

    expect(await screen.findByText(said)).toBeInTheDocument()
  })
})

describe("nothing the earlier account's screens say reaches the next one", () => {
  const LISTING_ID = "00000000-0000-4000-8000-000000000101"
  const emptySaved = okPage([], { limit: 50 })

  it("the refusal of a change pressed after the switch is not announced as theirs", async () => {
    const server = sharedCookieServer(ALICE, () => emptySaved)
    const app = renderApp("/open", [{ path: "/open", element: <SaveButton kind="provider" id={LISTING_ID} name="Imran" /> }])
    await app.who(signedIn(ALICE))
    await settle()

    server.signInAs(BOB)
    await app.user.click(screen.getByRole("button", { name: /Imran/ }))
    await app.who(signedIn(BOB))
    await settle()

    expect(await screen.findByText(ACCOUNT_CHANGED_MESSAGE)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/secure session|couldn.t save|something went wrong/i)
    expect(server.performed).toEqual([])
  })

  /** Any screen that reports an outcome itself, without the shared write hooks. */
  function ReportsLater({ work }: { work: () => Promise<unknown> }) {
    const { show } = useToast()
    return (
      <button
        onClick={() =>
          void work().then(
            () => show("It worked for Alice"),
            () => show("It failed for Alice", { tone: "error" })
          )
        }
      >
        Go
      </button>
    )
  }

  it.each(["resolve", "reject"] as const)("a message a replaced screen sends later (%s) is dropped", async (how) => {
    let finish!: () => void
    const work = new Promise<void>((resolve, reject) => {
      finish = () => (how === "resolve" ? resolve() : reject(new Error("late")))
    })
    const server = sharedCookieServer(ALICE)
    const app = renderApp("/open", [{ path: "/open", element: <ReportsLater work={() => work} /> }])
    await app.who(signedIn(ALICE))
    await app.user.click(screen.getByRole("button", { name: "Go" }))

    server.signInAs(BOB)
    await app.reread()
    await act(async () => finish())
    await settle()

    expect(document.body).not.toHaveTextContent(/for Alice/)
  })

  it("a message already showing is taken down with its screen", async () => {
    const server = sharedCookieServer(ALICE)
    const app = renderApp("/open", [{ path: "/open", element: <ReportsLater work={() => Promise.resolve()} /> }])
    await app.who(signedIn(ALICE))
    await app.user.click(screen.getByRole("button", { name: "Go" }))
    await screen.findByText("It worked for Alice")

    server.signInAs(BOB)
    await app.reread()

    // Well inside the few seconds a message stays up on its own.
    await waitFor(() => expect(screen.queryByText("It worked for Alice")).not.toBeInTheDocument(), { timeout: 1000 })
    expect(screen.getByText(ACCOUNT_CHANGED_MESSAGE)).toBeInTheDocument()
  })

  it("the same screen, unchanged account: its message is shown", async () => {
    sharedCookieServer(ALICE)
    const app = renderApp("/open", [{ path: "/open", element: <ReportsLater work={() => Promise.resolve()} /> }])
    await app.who(signedIn(ALICE))
    await app.user.click(screen.getByRole("button", { name: "Go" }))
    expect(await screen.findByText("It worked for Alice")).toBeInTheDocument()
  })

  it("a session that ended under a press is explained once, as ended", async () => {
    const server = sharedCookieServer(ALICE, (call) => (call.method === "GET" ? emptySaved : fail(401, "session_expired")))
    const app = renderApp("/open", [{ path: "/open", element: <SaveButton kind="provider" id={LISTING_ID} name="Imran" /> }])
    await app.who(signedIn(ALICE))
    await settle()

    await app.user.click(screen.getByRole("button", { name: /Imran/ }))
    await app.who("anonymous")
    await settle()

    expect(screen.getAllByText(SESSION_ENDED_MESSAGE)).toHaveLength(1)
    expect(server.performed).toHaveLength(1)
  })

  it("logging out says nothing about an ended session", async () => {
    sharedCookieServer(ALICE)
    const app = renderApp("/open", [{ path: "/open", element: <p>page</p> }])
    await app.who(signedIn(ALICE))
    await act(() => app.auth().logout())
    await settle()
    expect(screen.queryByText(SESSION_ENDED_MESSAGE)).not.toBeInTheDocument()
  })
})

describe("saved items", () => {
  const LISTING = "00000000-0000-4000-8000-000000000101"
  const heart = () => screen.getByRole("button", { name: /Imran/ })
  const savedPage = (ids: string[]) => okPage(ids.map((id) => ({ item: { id, kind: "provider" }, savedAt: "2026-11-01T00:00:00Z" })), { limit: 50 })
  const routesWithHeart: RouteObject[] = [{ path: "/open", element: <SaveButton kind="provider" id={LISTING} name="Imran" /> }]

  it("a list still loading for one account never lands in the next one's", async () => {
    const aliceList = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, (_call, actor) => (actor.name === ALICE.name ? aliceList.promise : savedPage([])))
    const app = renderApp("/open", routesWithHeart)
    await app.who(signedIn(ALICE))
    await waitFor(() => expect(server.calls.some((c) => c.path === "/saved")).toBe(true))

    server.signInAs(BOB)
    await app.reread()
    await act(async () => aliceList.resolve(savedPage([LISTING]))) // Alice's answer arrives late
    await settle()
    await app.reread() // and the heart is drawn again, so it shows whatever the set now holds

    expect(heart()).toHaveAttribute("aria-pressed", "false")
  })

  it("a save that finishes after the account changed is not shown as the next one's", async () => {
    const saving = deferred<MockReply>()
    const server = sharedCookieServer(ALICE, (call) => (call.method === "PUT" ? saving.promise : savedPage([])))
    const app = renderApp("/open", routesWithHeart)
    await app.who(signedIn(ALICE))
    await settle()
    await app.user.click(heart()) // Alice's own save, sent as Alice

    server.signInAs(BOB)
    await app.reread()
    await settle()
    await act(async () => saving.resolve({ status: 204 }))
    await settle()

    expect(server.performed.map((p) => p.actor)).toEqual([ALICE.name])
    expect(heart()).toHaveAttribute("aria-pressed", "false")
  })
})

describe("an expired session", () => {
  it("closes a protected screen and sends nothing", async () => {
    const server = sharedCookieServer(ADMIN_A, (call) => (call.method === "GET" ? ok([]) : fail(401, "session_expired")))
    const app = renderApp(routes.adminCategories, [
      { element: <AuthGate requires="admin" />, children: [{ path: routes.adminCategories, element: <AdminCategoriesPage /> }] },
    ])
    await app.who(signedIn(ADMIN_A))
    server.signInAs(null)
    await app.reread()
    await waitFor(() => expect(app.router.state.location.pathname).toBe(routes.adminLogin))
    expect(server.performed).toEqual([])
    expect(within(document.body).queryByRole("heading", { name: "Categories" })).not.toBeInTheDocument()
  })
})
