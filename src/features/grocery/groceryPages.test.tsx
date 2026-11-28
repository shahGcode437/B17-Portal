import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CancelOrderDialog } from "@/features/grocery/CancelOrderDialog"
import { GroceryDeliveryPage } from "@/features/grocery/GroceryDeliveryPage"
import { GroceryLandingPage } from "@/features/grocery/GroceryLandingPage"
import { GroceryListPage } from "@/features/grocery/GroceryListPage"
import { GroceryOrderPage } from "@/features/grocery/GroceryOrderPage"
import { GroceryReviewPage } from "@/features/grocery/GroceryReviewPage"
import { GrocerySubmittedPage } from "@/features/grocery/GrocerySubmittedPage"
import { MyGroceryOrdersPage } from "@/features/grocery/MyGroceryOrdersPage"
import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { EMPTY_DELIVERY } from "@/features/grocery/orderRequest"
import { routes } from "@/config/routes"
import { AuthContext, type AuthContextValue } from "@/hooks/useAuth"
import { ToastContext } from "@/hooks/useToast"
import { installFetchMock, type MockReply } from "@/test/apiMock"
import { authContextValue, testUser } from "@/test/authFixtures"
import { GroceryBackend, TEST_BLOCKS } from "@/test/fixtures/groceryBackend"
import { LocationProbe } from "@/test/LocationProbe"
import type { CurrentUser } from "@/types/auth"

const USER = testUser({ displayName: "Ayesha Khan" })
const draft = () => useGroceryDraft.getState()

interface Options {
  user?: CurrentUser | null
  backend?: GroceryBackend
  /** Replaces the answer of the next matching call. */
  faults?: Record<string, ("network" | MockReply)[]>
  auth?: Partial<AuthContextValue>
}

function open(url: string, options: Options = {}) {
  const backend = options.backend ?? new GroceryBackend()
  const user = options.user === undefined ? USER : options.user
  const { calls } = installFetchMock((call) => {
    const key = `${call.method} ${call.path}`
    const fault = options.faults?.[key]?.shift()
    const search = new URL(call.url, "http://test.invalid").searchParams
    const reply = () =>
      backend.route(call.method, call.path, search, call.body, call.headers.get("Idempotency-Key"), user ? { key: user.id, emailVerified: user.emailVerified } : null) as MockReply
    if (fault === "network") return "network-error"
    return fault ?? reply()
  })
  const auth = authContextValue({ user, ...options.auth })
  const show = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <AuthContext.Provider value={auth}>
        <ToastContext.Provider value={{ show }}>
          <Routes>
            <Route path={routes.grocery} element={<GroceryLandingPage />} />
            <Route path={routes.groceryNew} element={<GroceryListPage />} />
            <Route path={routes.groceryDelivery} element={<GroceryDeliveryPage />} />
            <Route path={routes.groceryReview} element={<GroceryReviewPage />} />
            <Route path={routes.grocerySubmitted} element={<GrocerySubmittedPage />} />
            <Route path={routes.profileGrocery} element={<MyGroceryOrdersPage />} />
            <Route path={routes.groceryOrder} element={<GroceryOrderPage />} />
            <Route path="*" element={<p>elsewhere</p>} />
          </Routes>
          <LocationProbe />
        </ToastContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
  return { ...view, backend, calls, auth, show, user: userEvent.setup() }
}

const location = () => screen.getByTestId("location").textContent
const h1 = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name })

function fillDraft(owner: string | null = USER.id) {
  useGroceryDraft.setState({ ownerId: owner })
  draft().addItem({ name: "Basmati rice", quantity: "5", unit: "kg", preferredBrand: "", substitution: "ask", note: "" })
  draft().setDelivery({ ...EMPTY_DELIVERY, contactName: "Ayesha Khan", contactPhone: "0300 1234567", block: TEST_BLOCKS[0], addressLine: "House 17, Street 4" })
}

beforeEach(() => draft().reset())

describe("Grocery landing page", () => {
  it("shows the server's availability, areas, hours, payment and both ways in", async () => {
    open("/grocery")

    expect(await screen.findByText("Accepting orders now")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Start your grocery list" })).toHaveAttribute("href", "/grocery/new")
    expect(screen.getByRole("link", { name: "My Grocery Orders" })).toHaveAttribute("href", "/profile/grocery")
    expect(within(screen.getByRole("list", { name: "Blocks we deliver to" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(TEST_BLOCKS)
    expect(screen.getByText("Every day — 10:00 AM to 8:00 PM (Pakistan time).")).toBeInTheDocument()
    const steps = within(screen.getByRole("region", { name: "How it works" })).getAllByRole("heading", { level: 3 })
    expect(steps.map((step) => step.textContent)).toEqual([
      "Step 1: Send your list",
      "Step 2: Confirm your order",
      "Step 3: Get it delivered",
      "Step 4: Pay on delivery",
    ])
    expect(screen.getByText("Our team confirms availability, order details and the total price with you.")).toBeInTheDocument()
    expect(
      screen.getByText("Your total price, including any applicable delivery or service charges, is confirmed before your order is prepared.")
    ).toBeInTheDocument()
    expect(screen.getAllByText("Pay in cash when your order arrives.")).toHaveLength(2)
    expect(screen.getByText(/we follow your substitution choice.*we confirm it with you again/)).toBeInTheDocument()
    expect(screen.getByText("We deliver in B-17, Islamabad, to:")).toBeInTheDocument()
  })

  it("says nothing about procurement, offers no payment it can't take, and claims no wider delivery than is listed", async () => {
    const { container } = open("/grocery")
    await screen.findByText("Accepting orders now")
    const words = container.textContent ?? ""
    expect(words).not.toMatch(/local (shops|markets?)|\bwe (shop|buy)\b|buying|price list|paid online|cash on delivery only/i)
    expect(words).not.toMatch(/\bcard\b|online (payment|transfer)|bank|wallet|easypaisa|jazzcash/i)
    // Two test blocks are listed, so neither "all of B-17" claim may appear.
    expect(words).not.toMatch(/all sectors|anywhere in B-17/i)
  })

  it("shows the approved hours from the server's settings, midnight as the end of the day", async () => {
    const backend = new GroceryBackend()
    backend.schedule = { ...backend.schedule, opensAt: "08:00", closesAt: "00:00" }
    open("/grocery", { backend })

    expect(await screen.findByText("Every day — 8:00 AM to 12:00 Midnight (Pakistan time).")).toBeInTheDocument()
    expect(screen.getByText("Send your list before 12:00 Midnight (Pakistan time).")).toBeInTheDocument()
  })

  it("with no area listed it says orders can't be placed, not an empty list", async () => {
    const backend = new GroceryBackend()
    backend.blocks = []
    open("/grocery", { backend })

    expect(await screen.findByText("Delivery areas aren't set up yet, so orders can't be placed.")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Blocks we deliver to" })).not.toBeInTheDocument()
  })

  it("switched off: no way to start, but existing orders stay reachable", async () => {
    const backend = new GroceryBackend()
    backend.enabled = false
    backend.blocks = []
    open("/grocery", { backend })

    expect(await screen.findByText("Grocery ordering is switched off")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /start your grocery list|prepare a list/i })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "My Grocery Orders" })).toBeInTheDocument()
    expect(screen.getByText("Delivery areas aren't set up yet, so orders can't be placed.")).toBeInTheDocument()
  })

  it.each([
    ["closed", "Closed right now"],
    ["full", "Today's order places are full"],
  ] as const)("%s: a list may be prepared, and says it cannot be sent yet", async (state, title) => {
    const backend = new GroceryBackend()
    backend[state] = true
    open("/grocery", { backend })

    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Prepare a list" })).toBeInTheDocument()
    expect(screen.getByText(/can only be sent while orders are being accepted/)).toBeInTheDocument()
  })

  it("an unreachable server is an error with a retry, never a pretend open shop", async () => {
    const { user } = open("/grocery", { faults: { "GET /grocery/availability": ["network"] } })

    expect(await screen.findByText("Couldn't check whether ordering is open")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /start your grocery list|prepare a list/i })).not.toBeInTheDocument()
    expect(screen.queryByText("Accepting orders now")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Accepting orders now")).toBeInTheDocument()
  })
})

async function addItem(user: ReturnType<typeof userEvent.setup>, name: string, quantity: string, unit = "kg") {
  const form = (await screen.findByRole("heading", { name: "Add an item" })).closest("section")!
  await user.type(within(form).getByLabelText("Item"), name)
  await user.type(within(form).getByLabelText("Quantity"), quantity)
  await user.selectOptions(within(form).getByLabelText("Unit"), unit)
  await user.click(within(form).getByRole("button", { name: "Add to list" }))
}

describe("the grocery list builder", () => {
  it("adds, edits and removes items, announcing each change", async () => {
    const { user } = open("/grocery/new")
    await addItem(user, "Basmati rice", "2.50")
    await addItem(user, "Eggs", "1.5", "dozen")

    const list = screen.getByRole("list", { name: "Grocery items" })
    expect(within(list).getByText("2.5 kg")).toBeInTheDocument()
    expect(within(list).getByText("1.5 dozen")).toBeInTheDocument()
    expect(screen.getByLabelText("Item")).toHaveValue("")
    expect(screen.getByText("2 of 50 items")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Edit Eggs" }))
    const editing = screen.getByRole("button", { name: "Save item" }).closest("form")!
    await user.click(within(editing).getByRole("button", { name: /Brand, substitutes and notes/ }))
    await user.type(within(editing).getByLabelText(/Preferred brand/), "Farm fresh")
    await user.selectOptions(within(editing).getByLabelText("If it isn't available"), "none")
    await user.click(within(editing).getByRole("button", { name: "Save item" }))
    expect(within(list).getByText("Brand: Farm fresh")).toBeInTheDocument()
    expect(within(list).getByText("No substitutes")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove Basmati rice" }))
    await waitFor(() => expect(within(list).queryByText("Basmati rice")).not.toBeInTheDocument())
    expect(screen.getByText("Removed Basmati rice.")).toBeInTheDocument()
    expect(draft().items.map((i) => i.name)).toEqual(["Eggs"])
  })

  it("refuses an exact quantity outside the unit's rules, with a linked message", async () => {
    const { user } = open("/grocery/new")
    await addItem(user, "Rice", "50.001")

    const quantity = screen.getByLabelText("Quantity")
    expect(quantity).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent("Use at most 50 kg.")
    expect(quantity.getAttribute("aria-describedby")).toContain("-quantity-error")
    expect(draft().items).toEqual([])
  })

  it("stops at the server's line limit", async () => {
    const backend = new GroceryBackend()
    backend.maxItems = 2
    const { user } = open("/grocery/new", { backend })
    await addItem(user, "Rice", "1")
    await addItem(user, "Milk", "1", "litre")

    expect(screen.getByText("Your list has the most items one order allows (2).")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add to list" })).not.toBeInTheDocument()
  })

  it("does not silently drop an item that was typed but not added", async () => {
    const { user } = open("/grocery/new")
    await addItem(user, "Rice", "1")
    await user.type(screen.getByLabelText("Item"), "Sugar")

    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByRole("alert")).toHaveTextContent("isn't on your list yet")
    expect(location()).toBe("/grocery/new")
  })

  it("is not offered while ordering is switched off", async () => {
    const backend = new GroceryBackend()
    backend.enabled = false
    open("/grocery/new", { backend })

    expect(await screen.findByText("Grocery ordering is switched off")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add to list" })).not.toBeInTheDocument()
  })

  it("does not show another account's list", async () => {
    fillDraft("someone-else")
    open("/grocery/new")

    expect(await screen.findByRole("heading", { name: "Sign in to continue your list" })).toBeInTheDocument()
    expect(screen.queryByText("Basmati rice")).not.toBeInTheDocument()
  })
})

describe("delivery details", () => {
  beforeEach(() => fillDraft(null))

  it("asks a signed-out visitor to sign in first, and comes back here", async () => {
    const { user } = open("/grocery/new/delivery", { user: null })

    expect(await screen.findByRole("heading", { name: "Sign in to add delivery details" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Phone number")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Log in or create an account" }))
    expect(location()).toBe("/login")
    expect(draft().items).toHaveLength(1)
  })

  it("tells an unverified account to verify, and re-checks on request", async () => {
    useGroceryDraft.setState({ ownerId: USER.id })
    const refreshMe = vi.fn(() => Promise.resolve(true))
    const { user } = open("/grocery/new/delivery", { user: testUser({ emailVerified: false }), auth: { refreshMe } })

    expect(await screen.findByRole("region", { name: "Email verification" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "I've verified my email" }))
    expect(refreshMe).toHaveBeenCalledWith({ fresh: true })
  })

  it("validates the phone, block and address, and offers only the server's blocks", async () => {
    draft().setDelivery(EMPTY_DELIVERY)
    const { user } = open("/grocery/new/delivery")
    const block = await screen.findByLabelText("Block")
    expect(within(block).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose your block", ...TEST_BLOCKS])
    expect(screen.getByLabelText("Contact name")).toHaveValue("Ayesha Khan") // from the account

    await user.type(screen.getByLabelText("Phone number"), "12345")
    await user.click(screen.getByRole("button", { name: "Review order" }))

    expect(await screen.findByText(/Enter a Pakistani phone number/)).toBeInTheDocument()
    expect(screen.getByText("Choose your block from the list.")).toBeInTheDocument()
    expect(screen.getByText("Enter your house and street.")).toBeInTheDocument()
    expect(location()).toBe("/grocery/new/delivery")

    await user.clear(screen.getByLabelText("Phone number"))
    await user.type(screen.getByLabelText("Phone number"), "0300 1234567")
    await user.selectOptions(block, TEST_BLOCKS[1])
    await user.type(screen.getByLabelText("House and street"), "House 3, Street 9")
    await user.click(screen.getByRole("button", { name: "Review order" }))
    expect(await h1("Check your order")).toBeInTheDocument()
    expect(draft().delivery.block).toBe(TEST_BLOCKS[1])
  })
})

describe("review and send", () => {
  beforeEach(() => fillDraft())

  it("sends the order once and shows the confirmation with its reference", async () => {
    const { user, calls, backend } = open("/grocery/new/review")
    expect(await screen.findByText("Your total is confirmed before preparation")).toBeInTheDocument()

    const send = screen.getByRole("button", { name: "Send my order" })
    await user.dblClick(send)

    expect(await h1("Order sent")).toBeInTheDocument()
    expect(screen.getByText(backend.orders[0].detail.reference)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1)
    expect(draft()).toMatchObject({ items: [], sentOrderId: null })
    expect(location()).toBe(`/profile/grocery/${backend.orders[0].detail.id}/submitted`)
  })

  it("an unknown outcome offers only a safe resend, which creates no second order", async () => {
    const backend = new GroceryBackend()
    // the order is stored, then the answer is lost
    const faults: Options["faults"] = { "POST /grocery/orders": ["network"] }
    backend.seed("nobody") // an unrelated order, to prove counts are about ours
    const { user, calls } = open("/grocery/new/review", { backend, faults })
    await user.click(await screen.findByRole("button", { name: "Send my order" }))

    const panel = await screen.findByRole("alert", { name: "We couldn't confirm your order" })
    expect(within(panel).getByRole("link", { name: "Check My Grocery Orders" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send my order" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Edit list" })).not.toBeInTheDocument()

    await user.click(within(panel).getByRole("button", { name: "Send the same order again" }))

    expect(await h1("Order sent")).toBeInTheDocument()
    const posts = calls.filter((c) => c.method === "POST")
    expect(posts).toHaveLength(2)
    expect(posts[1].headers.get("Idempotency-Key")).toBe(posts[0].headers.get("Idempotency-Key"))
    expect(backend.orders.filter((o) => o.owner === USER.id)).toHaveLength(1)
  })

  it("editing an unconfirmed order needs an explicit confirmation", async () => {
    const { user } = open("/grocery/new/review", { faults: { "POST /grocery/orders": ["network"] } })
    await user.click(await screen.findByRole("button", { name: "Send my order" }))
    await user.click(await screen.findByRole("button", { name: "Edit my order instead" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("you'll have two orders")
    await user.click(within(dialog).getByRole("button", { name: "Keep it unchanged" }))
    expect(draft().phase).toBe("unconfirmed")

    await user.click(screen.getByRole("button", { name: "Edit my order instead" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "I've checked: let me edit" }))
    expect(draft().phase).toBe("idle")
    expect(screen.getByRole("link", { name: "Edit list" })).toBeInTheDocument()
  })

  it("shows a refusal in plain words with the way forward, and keeps the list", async () => {
    const backend = new GroceryBackend()
    backend.seed(USER.id)
    backend.seed(USER.id)
    const { user } = open("/grocery/new/review", { backend })

    await user.click(await screen.findByRole("button", { name: "Send my order" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("You have the most open grocery orders allowed")
    expect(screen.getByRole("link", { name: "See My Grocery Orders" })).toBeInTheDocument()
    expect(draft().items).toHaveLength(1)
  })

  it("cannot send while closed", async () => {
    const backend = new GroceryBackend()
    backend.closed = true
    open("/grocery/new/review", { backend })

    expect(await screen.findByText("Closed right now")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send my order" })).toBeDisabled()
  })

  it("cannot send from an unverified account", async () => {
    open("/grocery/new/review", { user: testUser({ id: USER.id, emailVerified: false }) })

    expect(await screen.findByRole("button", { name: "Send my order" })).toBeDisabled()
    expect(screen.getByText("Verify your email address to send the order.")).toBeInTheDocument()
  })
})

describe("after a reload in the middle of sending", () => {
  const KEY = "b17:grocery-unconfirmed"
  const interrupted = (owner: string = USER.id, sentAt = Date.now() - 5_000) => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ owner, sentAt }))
    draft().loadRecovery(USER.id)
  }
  const notice = () => screen.queryByRole("region", { name: "Check your last order before sending another" })

  it("finds the order that did arrive, and stays until the customer says they've checked", async () => {
    const backend = new GroceryBackend()
    const order = backend.seed(USER.id)
    backend.orders[0].detail.submittedAt = new Date().toISOString() // `seed` returns a copy
    interrupted()
    const { user, calls } = open("/grocery", { backend })

    expect(await screen.findByText(new RegExp(`We found an order received around then: ${order.reference}`))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: `See order ${order.reference}` })).toHaveAttribute("href", `/profile/grocery/${order.id}`)
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]) // nothing is ever sent by itself

    await user.click(screen.getByRole("button", { name: "I've checked my orders" }))
    expect(notice()).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it("an older order is not taken for it", async () => {
    const backend = new GroceryBackend()
    backend.seed(USER.id)
    backend.orders[0].detail.submittedAt = new Date(Date.now() - 60 * 60_000).toISOString()
    interrupted()
    open("/grocery/new", { backend })

    expect(await screen.findByText("We don't see it in your orders yet, so it may not have reached us.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check my orders again" })).toBeInTheDocument()
  })

  it("the next order can't be sent until it has been checked", async () => {
    fillDraft()
    interrupted()
    const { user, backend } = open("/grocery/new/review")

    const send = await screen.findByRole("button", { name: "Send my order" })
    expect(send).toBeDisabled()
    expect(screen.getByText("Check your last order above before sending this one.")).toBeInTheDocument()
    await user.click(await screen.findByRole("button", { name: "I've checked my orders" }))
    await waitFor(() => expect(send).toBeEnabled())
    await user.click(send)
    expect(await h1("Order sent")).toBeInTheDocument()
    expect(backend.orders).toHaveLength(1)
  })

  it("if the orders can't be read it can't be waved away", async () => {
    interrupted()
    const { user } = open("/grocery", { faults: { "GET /grocery/orders": ["network"] } })

    expect(await screen.findByText("We couldn't check your orders just now.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "I've checked my orders" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Check my orders again" }))
    expect(await screen.findByRole("button", { name: "I've checked my orders" })).toBeInTheDocument()
  })

  it("another account's unfinished send is never shown, and is removed", async () => {
    interrupted("someone-else")
    const { calls } = open("/grocery")

    await screen.findByText("Accepting orders now")
    expect(notice()).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
    expect(calls.map((call) => call.path)).not.toContain("/grocery/orders")
  })
})

describe("My Grocery Orders", () => {
  it("lists my orders with status and price, without personal details, and loads more", async () => {
    const backend = new GroceryBackend()
    for (let n = 0; n < 12; n += 1) backend.seed(USER.id)
    backend.seed("someone-else")
    const newest = backend.orders.filter((o) => o.owner === USER.id).at(-1)!.detail.id
    backend.staffConfirm(newest)
    const { user, container } = open("/profile/grocery", { backend })

    const list = await screen.findByRole("list", { name: "Your grocery orders" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(10)
    expect(screen.getByText("12 orders")).toBeInTheDocument()
    // "New order" opens the order form itself, not the information page about Grocery.
    expect(screen.getByRole("link", { name: "New order" })).toHaveAttribute("href", "/grocery/new")
    expect(within(list).getByText("Rs 2,100 to pay")).toBeInTheDocument()
    expect(within(list).getAllByText("Price to be confirmed")).toHaveLength(9)
    for (const secret of ["+92300", "0300", "House 17", "Ayesha", "Blue gate"]) {
      expect(list.textContent).not.toContain(secret)
    }

    await user.click(screen.getByRole("button", { name: "Load More" }))
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(12))
    expect(container.textContent).not.toContain(backend.orders.at(-1)!.detail.reference) // not mine
  })

  it("a delivered order shows its total: nothing left to pay, and no claim of payment from the status", async () => {
    const backend = new GroceryBackend()
    const { id } = backend.seed(USER.id)
    backend.staffConfirm(id)
    backend.staffMove(id, "preparing")
    backend.staffMove(id, "out_for_delivery")
    backend.staffDeliver(id)
    open("/profile/grocery", { backend })

    const list = await screen.findByRole("list", { name: "Your grocery orders" })
    expect(within(list).getByText("Total Rs 2,100")).toBeInTheDocument()
    expect(list.textContent).not.toMatch(/to pay|paid/i)
  })

  it("filters by status, with its own empty state", async () => {
    const backend = new GroceryBackend()
    backend.seed(USER.id)
    const { user, calls } = open("/profile/grocery", { backend })
    await screen.findByRole("list", { name: "Your grocery orders" })

    await user.click(screen.getByRole("button", { name: "Delivered" }))

    expect(await screen.findByText("No delivered orders")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delivered" })).toHaveAttribute("aria-pressed", "true")
    expect(calls.at(-1)!.url).toContain("status=delivered")
    await user.click(screen.getByRole("button", { name: "Show all orders" }))
    expect(await screen.findByRole("list", { name: "Your grocery orders" })).toBeInTheDocument()
  })

  it("has honest empty and error states", async () => {
    const { user } = open("/profile/grocery", { faults: { "GET /grocery/orders": ["network"] } })
    expect(await screen.findByText("Couldn't load your grocery orders")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("No grocery orders yet")).toBeInTheDocument()
  })

  it("sends no request for an unverified account", async () => {
    const { calls } = open("/profile/grocery", { user: testUser({ emailVerified: false }) })
    expect(await screen.findByRole("region", { name: "Email verification" })).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})

describe("one order", () => {
  function setUp(prepare: (backend: GroceryBackend, id: string) => void = () => {}) {
    const backend = new GroceryBackend()
    const { id } = backend.seed(USER.id)
    prepare(backend, id)
    return { backend, id, view: open(`/profile/grocery/${id}`, { backend }) }
  }

  it("a submitted order has no price and can be cancelled with the revision on screen", async () => {
    const { view, backend } = setUp()
    expect(await screen.findByText("No price yet. Our team will confirm the total with you before preparing your order.")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Order progress" }).querySelector('[aria-current="step"]')).toHaveTextContent("Submitted")

    await view.user.click(screen.getByRole("button", { name: "Cancel order" }))
    const dialog = await screen.findByRole("dialog")
    await view.user.type(within(dialog).getByLabelText(/Reason/), "Changed my mind")
    await view.user.click(within(dialog).getByRole("button", { name: "Cancel order" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(view.calls.find((c) => c.method === "POST")!.body).toEqual({ revision: 1, reason: "Changed my mind" })
    expect(await screen.findByText(/You cancelled it on/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument()
    expect(backend.orders[0].detail.status).toBe("cancelled")
  })

  it("a stale cancellation shows the latest version instead", async () => {
    const { view, backend, id } = setUp()
    await view.user.click(await screen.findByRole("button", { name: "Cancel order" }))
    backend.staffConfirm(id) // the team confirmed meanwhile

    await view.user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel order" }))

    expect(await screen.findByText(/This order can no longer be cancelled —/)).toBeInTheDocument()
    expect(await screen.findByText("Cash on delivery: Rs 2,100")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(backend.orders[0].detail.status).toBe("confirmed")
  })

  it("shows recorded totals, an earlier total, a reduction and the cash due, never as the customer's own approval", async () => {
    const { view } = setUp((backend, id) => {
      backend.staffConfirm(id)
      backend.staffReconfirm(id, 225_000, 10_000, 15_000)
      backend.staffMove(id, "preparing")
      backend.staffReduce(id, 230_050)
    })

    const price = (await screen.findByRole("heading", { name: "Price and payment" })).closest("section")!
    expect(price).toHaveTextContent("ItemsRs 2,250")
    expect(price).toHaveTextContent("Service feeRs 100")
    expect(price).toHaveTextContent("Delivery feeRs 150")
    expect(price).toHaveTextContent("Recorded totalRs 2,500")
    expect(price).toHaveTextContent("Reduced by− Rs 199.50")
    expect(price).toHaveTextContent("Final amountRs 2,300.50")
    expect(price).toHaveTextContent("Cash on delivery: Rs 2,300.50")
    expect(price).toHaveTextContent("Earlier recorded totals")
    expect(price).toHaveTextContent("Rs 2,100")
    expect(price).toHaveTextContent("Recorded by our team after a phone call")
    expect(view.container.textContent).not.toMatch(/you (approved|accepted|consented|agreed)|your (approval|consent)/i)
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument()
    expect(screen.getByText(/can no longer be cancelled here/)).toBeInTheDocument()
  })

  it("a failed delivery is back in preparing and not delivered or paid", async () => {
    const { view } = setUp((backend, id) => {
      backend.staffConfirm(id)
      backend.staffMove(id, "preparing")
      backend.staffMove(id, "out_for_delivery")
      backend.staffMove(id, "preparing")
    })

    expect(await screen.findByText("A delivery attempt didn't complete.")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Order progress" }).querySelector('[aria-current="step"]')).toHaveTextContent("Preparing")
    expect(view.container.textContent).not.toMatch(/Paid in cash|Received/)
  })

  it("a delivered order shows the cash the server recorded", async () => {
    setUp((backend, id) => {
      backend.staffConfirm(id)
      backend.staffMove(id, "preparing")
      backend.staffMove(id, "out_for_delivery")
      backend.staffDeliver(id)
    })

    expect(await screen.findByText("Paid in cash: Rs 2,100")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Order progress" }).querySelector('[aria-current="step"]')).toHaveTextContent("Delivered")
  })

  it("a team cancellation says the team tells the customer, and gives no reason", async () => {
    const { view } = setUp((backend, id) => backend.staffCancel(id))
    expect(await screen.findByText(/Our team cancelled it/)).toBeInTheDocument()
    expect(view.container.textContent).not.toMatch(/Your reason|Cash on delivery:/)
  })

  it("refreshes on request, keeping the last version if the refresh fails", async () => {
    const backend = new GroceryBackend()
    const { id } = backend.seed(USER.id)
    const faults: Options["faults"] = {}
    const view = open(`/profile/grocery/${id}`, { backend, faults })
    await screen.findByText(/Updates appear when you refresh/)
    backend.staffConfirm(id)

    await view.user.click(screen.getByRole("button", { name: "Refresh status" }))
    expect(await screen.findByText("Cash on delivery: Rs 2,100")).toBeInTheDocument()

    faults[`GET /grocery/orders/${id}`] = ["network"]
    await view.user.click(screen.getByRole("button", { name: "Refresh status" }))
    expect(await screen.findByText(/Couldn't refresh/)).toBeInTheDocument()
    expect(screen.getByText("Cash on delivery: Rs 2,100")).toBeInTheDocument()
  })

  it("another person's order is simply not found", async () => {
    const backend = new GroceryBackend()
    const { id } = backend.seed("someone-else")
    open(`/profile/grocery/${id}`, { backend })
    expect(await h1("Order not found")).toBeInTheDocument()
  })

  it("the cancel dialog cannot be dismissed while the cancellation is in flight", async () => {
    const backend = new GroceryBackend()
    const order = backend.seed(USER.id)
    installFetchMock(() => new Promise<MockReply>(() => {}))
    const onOpenChange = vi.fn()
    render(
      <ToastContext.Provider value={{ show: vi.fn() }}>
        <CancelOrderDialog order={order} open onOpenChange={onOpenChange} onCancelled={vi.fn()} onStale={vi.fn()} />
      </ToastContext.Provider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Cancel order" }))

    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe("payment methods and all of B-17 (GROCERY-4C)", () => {
  const everyMethod = () => {
    const backend = new GroceryBackend()
    backend.paymentMethods = ["cash_on_delivery", "card", "bank_transfer", "easypaisa", "jazzcash"]
    return backend
  }
  const price = async () => (await screen.findByRole("heading", { name: "Price and payment" })).closest("section")!

  it("offers every switched-on method, with early payment optional and no card details asked", async () => {
    const { container } = open("/grocery", { backend: everyMethod() })
    await screen.findByText("Accepting orders now")

    const steps = within(screen.getByRole("region", { name: "How it works" })).getAllByRole("heading", { level: 3 })
    expect(steps.at(-1)).toHaveTextContent("Step 4: Pay your way")
    expect(screen.getByText("Pay using our available cash, card or online payment options.")).toBeInTheDocument()
    expect(screen.getByText("Pay after order confirmation or upon delivery using the available payment options.")).toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Ways to pay" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Cash on delivery",
      "Card on delivery",
      "Bank transfer",
      "Easypaisa",
      "JazzCash",
    ])
    expect(screen.getByText(/^Paying early is optional\./)).toBeInTheDocument()
    expect(screen.getByText(/B17-Portal doesn't ask for them/)).toBeInTheDocument()
    expect(container.querySelector("input")).toBeNull() // nothing here takes payment details
  })

  it.each([
    [["card"], "Pay using our available cash or card payment options.", /bank transfer|easypaisa|jazzcash|\bonline\b/i],
    [["easypaisa"], "Pay using our available cash or online payment options.", /\bcard (on|payments)|bank transfer|jazzcash/i],
  ] as const)("names only what is switched on: %j", async (extra, stepText, never) => {
    const backend = new GroceryBackend()
    backend.paymentMethods = ["cash_on_delivery", ...extra]
    const { container } = open("/grocery", { backend })
    await screen.findByText(stepText)
    expect(container.textContent).not.toMatch(never)
  })

  it("a server that doesn't say (older than this) is treated as cash only, with no all-of-B-17 claim", async () => {
    const backend = new GroceryBackend()
    const full = backend.availability.bind(backend)
    backend.availability = () => {
      const { paymentMethods: _methods, coversAllB17: _covers, ...older } = full()
      return older
    }
    const { container } = open("/grocery", { backend })
    await screen.findByText("Accepting orders now")
    expect(screen.getAllByText("Pay in cash when your order arrives.")).toHaveLength(2)
    expect(container.textContent).not.toMatch(/all sectors|anywhere in B-17|Pay your way/)
  })

  it("claims all of B-17 only once the server says a Super Admin confirmed it", async () => {
    const backend = new GroceryBackend()
    backend.coversAllB17 = true
    open("/grocery", { backend })

    expect(await screen.findByText("Delivering across all sectors and blocks of B-17, Islamabad.")).toBeInTheDocument()
    expect(screen.getByText("Receive your groceries conveniently at your doorstep anywhere in B-17.")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Blocks we deliver to" })).not.toBeInTheDocument()
  })

  function ordered(arrange: (backend: GroceryBackend, id: string) => void) {
    const backend = everyMethod()
    const { id } = backend.seed(USER.id)
    backend.staffConfirm(id)
    arrange(backend, id)
    return { id, backend, view: open(`/profile/grocery/${id}`, { backend }) }
  }

  it("an unpaid order says what is due and how it can be paid", async () => {
    ordered(() => {})
    expect(await screen.findByText("To pay: Rs 2,100")).toBeInTheDocument()
    await waitFor(async () =>
      expect(await price()).toHaveTextContent("Pay after order confirmation or upon delivery using the available payment options.")
    )
  })

  it("an order paid early is paid and plainly not delivered", async () => {
    const { view: { container } } = ordered((backend, id) => backend.staffPay(id, "bank_transfer"))

    expect(await screen.findByText("Paid by bank transfer: Rs 2,100")).toBeInTheDocument()
    expect(await price()).toHaveTextContent(/Our team confirmed this payment .*It isn't delivered yet/)
    expect(screen.getByRole("list", { name: "Order progress" }).querySelector('[aria-current="step"]')).toHaveTextContent("Confirmed")
    expect(container.textContent).not.toMatch(/To pay:|your order was delivered/i)
  })

  it("on its way and already paid, nothing is asked for at the door", async () => {
    const { view: { container } } = ordered((backend, id) => {
      backend.staffMove(id, "preparing")
      backend.staffMove(id, "out_for_delivery")
      backend.staffPay(id, "card")
    })

    expect(await screen.findByText("Paid by card: Rs 2,100")).toBeInTheDocument()
    expect(screen.getByText(/Your order is on its way\. It's already paid\./)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/have the cash ready|payment ready/)
  })

  it("a refund is shown only from the server's record, with the payment kept and no reason", async () => {
    const { backend, id, view: { container } } = ordered((fake, orderId) => {
      fake.staffPay(orderId, "jazzcash")
      fake.staffRefund(orderId)
    })

    expect(await screen.findByText("Refunded: Rs 2,100")).toBeInTheDocument()
    expect(await price()).toHaveTextContent("You paid Rs 2,100 with JazzCash.")
    expect(await price()).toHaveTextContent("This order was cancelled.")
    expect(container.textContent).not.toMatch(/To pay:|Cash on delivery:/)
    expect(backend.orders.find((o) => o.detail.id === id)!.detail.status).toBe("cancelled")
  })

  it("the list says paid or refunded only when the server does", async () => {
    const backend = everyMethod()
    const paid = backend.seed(USER.id).id
    backend.staffConfirm(paid)
    backend.staffPay(paid, "easypaisa")
    const refunded = backend.seed(USER.id).id
    backend.staffConfirm(refunded)
    backend.staffPay(refunded, "card")
    backend.staffRefund(refunded)
    open("/profile/grocery", { backend })

    const list = await screen.findByRole("list", { name: "Your grocery orders" })
    expect(within(list).getByText("Rs 2,100 paid")).toBeInTheDocument()
    expect(within(list).getByText("Payment refunded")).toBeInTheDocument()
  })
})
