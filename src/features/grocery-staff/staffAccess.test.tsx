import { act, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  BILAL,
  CUSTOMER_KEY,
  FOODIE,
  OWNER,
  PAUSED,
  RESIDENT,
  SANA,
  actionButton,
  dialog,
  fakeStaffServer,
  heading,
  renderStaffApp,
  returnToTab,
  type Account,
} from "@/test/groceryStaffHarness"

/** Everything private an order carries. None of it may be on screen when it shouldn't. */
const PRIVATE = ["Ayesha Khan", "0300 1234567", "+923001234567", "House 17, Street 4", "Blue gate", "Basmati rice"]

function expectNothingPrivate() {
  const text = document.body.textContent ?? ""
  for (const value of PRIVATE) expect(text).not.toContain(value)
  for (const link of document.querySelectorAll("a[href^='tel:']")) expect(link).toBeUndefined()
}

const nav = () => screen.getByRole("navigation", { name: "Admin" })
const navLinks = () => within(nav()).getAllByRole("link").map((link) => link.textContent)

describe("who gets into the grocery workspace", () => {
  it.each([
    ["a Super Admin", OWNER],
    ["a Moderator with the grocery scope", SANA],
  ])("%s does", async (_label, who: Account) => {
    const server = fakeStaffServer(who)
    server.store.seed(CUSTOMER_KEY)
    renderStaffApp("/admin/grocery")
    await heading("Grocery orders")
    expect(await screen.findByText("GRC-TEST0001")).toBeInTheDocument()
  })

  it.each([
    ["a Moderator without the grocery scope", FOODIE],
    ["a paused Moderator", PAUSED],
    ["a resident", RESIDENT],
  ])("%s does not, and no staff request is made", async (_label, who: Account) => {
    const server = fakeStaffServer(who)
    const order = server.store.seed(CUSTOMER_KEY)
    for (const path of ["/admin/grocery", `/admin/grocery/${order.id}`]) {
      const { router } = renderStaffApp(path)
      await heading("Grocery staff access only")
      expect(screen.queryByText("GRC-TEST0001")).not.toBeInTheDocument()
      expect(within(nav()).queryByRole("link", { name: /grocery/i })).not.toBeInTheDocument()
      router.dispose()
      document.body.innerHTML = ""
    }
    expect(server.staffCalls()).toEqual([])
  })

  it("a signed-out visitor is sent to the staff sign-in, and no staff request is made", async () => {
    const server = fakeStaffServer(null)
    const { router } = renderStaffApp("/admin/grocery")
    await heading("Admin Login")
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(router.state.location.state).toEqual({ from: "/admin/grocery" })
    expect(server.staffCalls()).toEqual([])
  })

  it("the staff sign-in sends a grocery Moderator on to the grocery workspace, not the admin dashboard", async () => {
    fakeStaffServer(SANA)
    const { router } = renderStaffApp("/admin/login")
    await heading("Grocery orders")
    expect(router.state.location.pathname).toBe("/admin/grocery")
  })

  it("the staff sign-in tells a Moderator of another scope that this account has no access", async () => {
    fakeStaffServer(FOODIE)
    const { router } = renderStaffApp("/admin/login")
    await heading("Admin Login")
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't an administrator account/)
    expect(router.state.location.pathname).toBe("/admin/login")
  })

  it("a grocery Moderator's staff navigation has Grocery only; a Super Admin's has every area", async () => {
    fakeStaffServer(SANA)
    const first = renderStaffApp("/admin/grocery")
    await heading("Grocery orders")
    expect(navLinks()).toEqual(["Grocery"])
    expect(within(nav()).getByRole("button", { name: "Log out" })).toBeInTheDocument()
    expect(screen.getByText("B-17 Portal · Staff")).toBeInTheDocument()
    first.router.dispose()
    document.body.innerHTML = ""

    fakeStaffServer(OWNER)
    renderStaffApp("/admin/grocery")
    await heading("Grocery orders")
    expect(navLinks()).toEqual(["Dashboard", "Listings", "Categories", "News & Updates", "Staff", "Grocery"])
  })
})

describe("the viewer's own order", () => {
  it("is never listed or counted, and its staff page refuses it, a Super Admin included", async () => {
    const server = fakeStaffServer(OWNER)
    const own = server.store.seed(`${OWNER.name}@staff`)
    server.store.seed(CUSTOMER_KEY)
    const { router } = renderStaffApp("/admin/grocery")
    expect(await screen.findByText("GRC-TEST0002")).toBeInTheDocument()
    expect(screen.queryByText("GRC-TEST0001")).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /^Submitted \(1\)/ })).toBeInTheDocument()

    await act(() => router.navigate(`/admin/grocery/${own.id}`))
    await heading("This is your own order")
    expectNothingPrivate()
    expect(screen.queryByRole("region", { name: "Actions" })).not.toBeInTheDocument()
    // The customer side stays open to them.
    const { user } = { user: (await import("@testing-library/user-event")).default.setup() }
    await user.click(screen.getByRole("button", { name: "View it as a customer" }))
    expect(router.state.location.pathname).toBe(`/profile/grocery/${own.id}`)
    expect(server.writes()).toEqual([])
  })
})

describe("losing the session or the access while an order is open", () => {
  async function openOrder(who: Account = SANA) {
    const server = fakeStaffServer(who)
    const order = server.store.seed(CUSTOMER_KEY)
    const app = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)
    expect(document.body).toHaveTextContent("House 17, Street 4")
    return { server, order, ...app }
  }

  it("an expired staff session on the next read: signed-out screen, nothing private left", async () => {
    const { server, user, router } = await openOrder()
    server.state.staffSessionStale = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Admin Login")
    expect(router.state.location.pathname).toBe("/admin/login")
    expectNothingPrivate()
  })

  it("an expired staff session on a change: nothing is claimed, and the screen is closed", async () => {
    const { server, user } = await openOrder()
    server.state.staffSessionStale = true
    await user.click(actionButton("Claim order"))
    await heading("Admin Login")
    expectNothingPrivate()
    expect(screen.queryByText("You claimed this order.")).not.toBeInTheDocument()
    expect(server.writes()).toHaveLength(1)
  })

  it("the scope removed, found by a change: the access screen replaces the order", async () => {
    const { server, user } = await openOrder()
    server.state.account = { ...SANA, staffScopes: [] }
    await user.click(actionButton("Claim order"))
    await heading("Grocery staff access only")
    expectNothingPrivate()
    expect(server.writes()).toHaveLength(1)
  })

  it("the scope removed, found on returning to the tab: no staff data is asked for again", async () => {
    const { server } = await openOrder()
    const before = server.staffCalls().length
    server.state.account = { ...SANA, staffScopes: [] }
    act(returnToTab)
    await heading("Grocery staff access only")
    expectNothingPrivate()
    expect(server.staffCalls()).toHaveLength(before)
  })

  it("a role change that keeps access updates the screen on the same Refresh", async () => {
    const { server, user } = await openOrder()
    server.staff.assign(server.store.orders[0].detail.id, { userId: BILAL.id, displayName: BILAL.name })
    server.state.account = { ...SANA, roles: ["admin"], staffScopes: [] } // made Super Admin meanwhile
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(actionButton("Record agreement")).toBeEnabled())
  })

  it("signed out in another tab: returning goes to sign-in with nothing private", async () => {
    const { server } = await openOrder()
    server.signInAs(null)
    act(returnToTab)
    await heading("Admin Login")
    expectNothingPrivate()
  })

  it("a refused read drops what was already on screen", async () => {
    const { server, user } = await openOrder()
    // The server refuses the order while /auth/me still reports the old access.
    const found = server.store.orders[0]
    found.owner = `${SANA.name}@staff`
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("This is your own order")
    expectNothingPrivate()
  })
})

describe("another account in the same browser", () => {
  it("logging out clears the screen", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)
    await user.click(within(nav()).getByRole("button", { name: "Log out" }))
    await heading("Admin Login")
    expectNothingPrivate()
  })

  it("a change pressed after another tab switched accounts is NOT replayed as that person", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)

    server.signInAs(BILAL)
    await user.click(actionButton("Claim order"))

    await waitFor(() => expect(server.writes()).toHaveLength(1))
    await waitFor(() => expect(screen.getByText(/Assignment:/).parentElement).toHaveTextContent("Unassigned"))
    expect(server.writes()).toHaveLength(1)
    expect(server.writes()[0].headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(server.staff.record(server.store.orders[0]).assignee).toBeUndefined()
  })

  it("switching to another staff account closes the open form and loads the order again as them", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    server.staff.assign(order.id, { userId: SANA.id, displayName: SANA.name })
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)
    await user.click(actionButton("Record issue"))
    await user.type(within(await dialog()).getByLabelText("What happened"), "Sana's private note")

    const before = server.staffCalls().length
    server.signInAs(BILAL)
    act(returnToTab)

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await heading(`Order ${order.reference}`)
    expect(document.body).not.toHaveTextContent("Sana's private note")
    expect(screen.getByText(/Assignment:/).parentElement).toHaveTextContent(`Assigned to ${SANA.name}`)
    expect(server.staffCalls().length).toBeGreaterThan(before)

    // Nothing typed by the first account comes back in a new form.
    await user.click(actionButton("Record issue"))
    expect(within(await dialog()).getByLabelText("What happened")).toHaveValue("")
  })

  it("keeps nothing in browser storage", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)
    await user.click(actionButton("Claim order"))
    await screen.findByText("You claimed this order.")
    const stored = JSON.stringify([{ ...localStorage }, { ...sessionStorage }])
    for (const value of [...PRIVATE, order.id, order.reference]) expect(stored).not.toContain(value)
  })
})
