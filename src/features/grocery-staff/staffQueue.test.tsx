import { act, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  BILAL,
  CUSTOMER_KEY,
  SANA,
  fakeStaffServer,
  heading,
  renderStaffApp,
  returnToTab,
} from "@/test/groceryStaffHarness"
import { RELOAD_AFTER_MS } from "@/features/grocery-staff/useStaffSession"

const member = { userId: SANA.id, displayName: SANA.name }

const queries = (server: ReturnType<typeof fakeStaffServer>) =>
  server
    .staffCalls()
    .map((call) => Object.fromEntries(new URL(call.url, "http://test.invalid").searchParams))
/** The requests for the LIST (the two count requests always ask for one row). */
const listQueries = (server: ReturnType<typeof fakeStaffServer>) => queries(server).filter((q) => q.limit === "12")
const rows = () => within(screen.getByRole("list", { name: "Orders" })).getAllByRole("link")
const statusFilter = (name: RegExp) => screen.getByRole("radio", { name })

function seeded() {
  const server = fakeStaffServer(SANA)
  const waiting = server.store.seed(CUSTOMER_KEY)
  const mine = server.store.seed("second@example.org")
  server.store.staffConfirm(mine.id)
  server.staff.assign(mine.id, member)
  const colleagues = server.store.seed("third@example.org")
  server.store.staffConfirm(colleagues.id)
  server.store.staffMove(colleagues.id, "preparing")
  server.store.staffMove(colleagues.id, "out_for_delivery")
  server.store.staffMove(colleagues.id, "preparing")
  server.staff.assign(colleagues.id, { userId: BILAL.id, displayName: BILAL.name })
  return { server, waiting, mine, colleagues }
}

describe("the grocery queue", () => {
  it("opens on the waiting work, using the server's list and counts", async () => {
    const { server } = seeded()
    renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(listQueries(server)).toEqual([{ status: "submitted", sort: "oldest", limit: "12", offset: "0" }])
    expect(queries(server)).toEqual(
      expect.arrayContaining([
        { assigned: "unassigned", limit: "1" },
        { assigned: "me", limit: "1" },
      ])
    )
    expect(rows()[0]).toHaveTextContent(/GRC-TEST0001.*Submitted.*Sent 27 Nov 2026.*Test Block A · 2 items · No price yet.*Unassigned/)
    expect(statusFilter(/^Submitted \(1\)/)).toBeChecked()
    expect(statusFilter(/^Confirmed \(1\)/)).not.toBeChecked()
    expect(statusFilter(/^Preparing \(1\)/)).toBeInTheDocument()
    expect(statusFilter(/^Delivered \(0\)/)).toBeInTheDocument()
    expect(statusFilter(/^All \(3\)/)).toBeInTheDocument()
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument()
  })

  it("shows no name, phone, address or item text anywhere", async () => {
    seeded()
    const { user } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(statusFilter(/^All/))
    await waitFor(() => expect(rows()).toHaveLength(3))
    const text = document.body.textContent ?? ""
    for (const value of ["Ayesha", "0300", "+92", "House 17", "Blue gate", "Basmati", "Eggs", "customer@"]) {
      expect(text).not.toContain(value)
    }
    expect(document.querySelector("a[href^='tel:']")).toBeNull()
  })

  it("shows who holds each order, and what needs a second look", async () => {
    seeded()
    renderStaffApp("/admin/grocery?status=all")
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows()[1]).toHaveTextContent("Rs 2,100 due")
    expect(rows()[1]).toHaveTextContent("Assigned to you")
    expect(rows()[2]).toHaveTextContent(`Assigned to ${BILAL.name}`)
    expect(rows()[2]).toHaveTextContent("1 failed delivery")
  })

  it("summarises the open orders from the server's counts, each linking to exactly those", async () => {
    const { server } = seeded()
    const { user, router } = renderStaffApp("/admin/grocery")
    const open = await screen.findByRole("region", { name: "Open orders" })
    await within(open).findByRole("link", { name: /Submitted\s*1/ })
    expect(open).toHaveTextContent(/Nobody has claimed1/)
    expect(open).toHaveTextContent(/Assigned to you1/)
    await user.click(within(open).getByRole("link", { name: /Confirmed\s*1/ }))
    expect(router.state.location.search).toBe("?status=confirmed&by=me")
    await waitFor(() =>
      expect(listQueries(server).at(-1)).toEqual({ status: "confirmed", assigned: "me", sort: "oldest", limit: "12", offset: "0" })
    )
  })

  it("filters by status, assignee, day and order, with the API's parameters", async () => {
    const { server } = seeded()
    const { user, router } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))

    await user.click(statusFilter(/^Confirmed/))
    await waitFor(() => expect(listQueries(server).at(-1)).toMatchObject({ status: "confirmed" }))

    await user.selectOptions(screen.getByLabelText("Assigned to"), "me")
    await waitFor(() => expect(listQueries(server).at(-1)).toMatchObject({ status: "confirmed", assigned: "me" }))

    await user.type(screen.getByLabelText("Sent on"), "2026-11-27")
    await waitFor(() => expect(listQueries(server).at(-1)).toMatchObject({ submittedOn: "2026-11-27" }))

    await user.selectOptions(screen.getByLabelText("Order"), "newest")
    await waitFor(() => expect(listQueries(server).at(-1)).toMatchObject({ sort: "newest" }))
    expect(router.state.location.search).toBe("?status=confirmed&on=2026-11-27&by=me&sort=newest")

    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(router.state.location.search).toBe("")
    expect(screen.getByLabelText("Assigned to")).toHaveValue("")
  })

  it("searches by reference only when asked, and only with a reference the API accepts", async () => {
    const { server } = seeded()
    const { user } = renderStaffApp("/admin/grocery?status=all")
    await waitFor(() => expect(rows()).toHaveLength(3))
    const before = server.staffCalls().length
    const box = screen.getByLabelText("Order reference")
    await user.type(box, "ab{Enter}")
    expect(screen.getByText("Enter 3 to 16 characters of the order reference.")).toBeInTheDocument()
    expect(server.staffCalls()).toHaveLength(before)

    await user.clear(box)
    await user.type(box, "test0002")
    expect(server.staffCalls()).toHaveLength(before) // typing alone sends nothing
    await user.click(screen.getByRole("button", { name: "Search" }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveTextContent("GRC-TEST0002")
    expect(listQueries(server).at(-1)).toMatchObject({ reference: "test0002" })
    // The counts follow the other filters.
    expect(statusFilter(/^All \(1\)/)).toBeInTheDocument()
  })

  it("pages through the server's results, and a filter starts again at page one", async () => {
    const server = fakeStaffServer(SANA)
    for (let n = 0; n < 15; n += 1) server.store.seed(`c${n}@example.org`)
    const { user, router } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(12))
    expect(screen.getByText("Showing 1–12 of 15")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Showing 13–15 of 15")
    expect(rows()).toHaveLength(3)
    expect(listQueries(server).at(-1)).toMatchObject({ offset: "12" })
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    // Opening an order and coming back keeps the page and filters.
    await user.click(rows()[0])
    await heading(/^Order GRC-TEST0013/)
    await user.click(screen.getByRole("link", { name: "Grocery queue" }))
    await screen.findByText("Showing 13–15 of 15")
    expect(router.state.location.search).toBe("?page=2")

    await user.selectOptions(screen.getByLabelText("Order"), "newest")
    await screen.findByText("Showing 1–12 of 15")
    expect(router.state.location.search).toBe("?sort=newest")
  })

  it("explains a page that no longer has anything on it", async () => {
    const server = fakeStaffServer(SANA)
    server.store.seed(CUSTOMER_KEY)
    const { user } = renderStaffApp("/admin/grocery?page=3")
    await screen.findByText("There are no orders on this page any more.")
    await user.click(screen.getByRole("button", { name: "Go to the first page" }))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })

  it("says plainly when nothing is waiting, or nothing matches", async () => {
    fakeStaffServer(SANA)
    const { user } = renderStaffApp("/admin/grocery")
    await screen.findByText("No new orders are waiting.")
    expect(screen.getByRole("region", { name: "Open orders" })).toHaveTextContent("No open order is waiting to be claimed.")
    await user.click(statusFilter(/^Delivered/))
    await screen.findByText("No orders match these filters.")
  })

  it("a failed load is an error with a retry, never an empty queue or a zero", async () => {
    const { server } = seeded()
    server.state.readsFail = "network"
    const { user } = renderStaffApp("/admin/grocery")
    await screen.findByText("Couldn't load the queue")
    expect(screen.queryByText("No new orders are waiting.")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Open orders" })).toHaveTextContent("Couldn't load this count.")
    expect(statusFilter(/^Submitted \(…\)/)).toBeInTheDocument()
    server.state.readsFail = null
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })

  it("refreshes on request and on returning to the tab (not more often than the interval), never by itself", async () => {
    const { server } = seeded()
    const { user } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    const lists = () => listQueries(server).length
    expect(lists()).toBe(1)

    // Straight back: the identity is checked, the data is recent enough.
    const checks = () => server.calls.filter((call) => call.path === "/auth/me").length
    const checkedBefore = checks()
    act(returnToTab)
    await waitFor(() => expect(checks()).toBe(checkedBefore + 1))
    expect(lists()).toBe(1)

    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + RELOAD_AFTER_MS + 1_000)
    server.store.seed("late@example.org")
    act(returnToTab)
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(lists()).toBe(2)
    later.mockRestore()

    server.store.seed("later@example.org")
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(lists()).toBe(3)
  })

  it("keeps the last list, and says so, when a refresh fails", async () => {
    const { server } = seeded()
    const { user } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    server.state.readsFail = "server"
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText(/Couldn't refresh/)
    expect(rows()).toHaveLength(1)
  })

  it("an expired staff session closes the queue", async () => {
    const { server } = seeded()
    const { user } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    server.state.staffSessionStale = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Admin Login")
    expect(document.body).not.toHaveTextContent("GRC-TEST0001")
  })

  it("lost access found by a refresh takes the list away", async () => {
    const { server } = seeded()
    const { user } = renderStaffApp("/admin/grocery")
    await waitFor(() => expect(rows()).toHaveLength(1))
    server.state.account = { ...SANA, staffScopes: [] }
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Grocery staff access only")
    expect(document.body).not.toHaveTextContent("GRC-TEST0001")
  })
})
