import { act, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BILAL,
  CUSTOMER_KEY,
  OWNER,
  SANA,
  actionButton,
  dialog,
  fakeStaffServer,
  heading,
  queryAction,
  renderStaffApp,
  returnToTab,
  type Account,
  type FakeStaffServer,
} from "@/test/groceryStaffHarness"
import { STAFF_WRITE_TIMEOUT_MS } from "@/features/grocery-staff/useStaffOrderWrite"
import { deferred } from "@/test/apiMock"
import type { UserEvent } from "@testing-library/user-event"

const member = (who: Account) => ({ userId: who.id, displayName: who.name })

type Stage = "submitted" | "confirmed" | "preparing" | "out_for_delivery"

/** An order at `stage`, priced at Rs 2,100 once confirmed, held by `holder` (nobody for `null`). */
async function open(stage: Stage, options: { who?: Account; holder?: Account | null } = {}) {
  const who = options.who ?? SANA
  const holder = options.holder === undefined ? who : options.holder
  const server = fakeStaffServer(who)
  const order = server.store.seed(CUSTOMER_KEY)
  if (stage !== "submitted") server.store.staffConfirm(order.id)
  if (stage === "preparing" || stage === "out_for_delivery") server.store.staffMove(order.id, "preparing")
  if (stage === "out_for_delivery") server.store.staffMove(order.id, "out_for_delivery")
  if (holder) server.staff.assign(order.id, member(holder))
  const app = renderStaffApp(`/admin/grocery/${order.id}`)
  await heading(`Order ${order.reference}`)
  const current = () => server.store.orders[0].detail
  return { server, order, current, ...app }
}

const status = () => screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement
const posts = (server: FakeStaffServer) => server.writes().map((call) => call.path.split("/").pop())
const lastBody = (server: FakeStaffServer) => server.writes().at(-1)!.body

async function submit(user: UserEvent, name: string) {
  await user.click(within(await dialog()).getByRole("button", { name }))
}

async function closed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
}

const field = (label: string | RegExp) => within(screen.getByRole("dialog")).getByLabelText(label)
const radio = (name: string) => within(screen.getByRole("dialog")).getByRole("radio", { name })
const checkbox = () => within(screen.getByRole("dialog")).getByRole("checkbox")

async function fillAgreement(user: UserEvent, amounts: { items: string; service: string; delivery: string; total: string }) {
  for (const [label, value] of [
    [/^Items \(Rs\)/, amounts.items],
    [/^Service fee \(Rs\)/, amounts.service],
    [/^Delivery fee \(Rs\)/, amounts.delivery],
    [/^Total the customer agreed to/, amounts.total],
  ] as const) {
    await user.clear(field(label))
    await user.type(field(label), value)
  }
}

describe("the order detail", () => {
  it("shows what is needed to handle it, with a call link built from the stored number", async () => {
    await open("submitted", { holder: null })
    const customer = screen.getByRole("region", { name: "Customer and delivery" })
    for (const text of ["Ayesha Khan", "0300 1234567", "Test Block A", "House 17, Street 4", "Blue gate"]) {
      expect(customer).toHaveTextContent(text)
    }
    expect(within(customer).getByRole("link", { name: "Call customer" })).toHaveAttribute("href", "tel:+923001234567")
    const items = screen.getByRole("region", { name: "2 items requested" })
    for (const text of ["Basmati rice", "5 kg", "Brand: Any good brand", "Ask the customer before substituting", "Eggs", "1.5 dozen", "No substitutes"]) {
      expect(items).toHaveTextContent(text)
    }
    expect(screen.getByRole("region", { name: "Recorded agreements" })).toHaveTextContent("No price has been recorded")
    expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Not collected")
    expect(document.querySelector("a[href*='wa.me']")).toBeNull()
  })

  it("an unknown order is 'not found'", async () => {
    fakeStaffServer(SANA)
    renderStaffApp("/admin/grocery/22222222-2222-4222-8222-999999999999")
    await heading("Order not found")
  })

  it("a first load that fails offers a retry that works", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    server.state.readsFail = "network"
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading("Couldn't load this order")
    server.state.readsFail = null
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await heading(`Order ${order.reference}`)
  })
})

describe("claim and release", () => {
  it("claims with one request, no body, the CSRF token, and shows only the server's answer", async () => {
    const { server, user } = await open("submitted", { holder: null })
    expect(queryAction("Record agreement")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("Claim this order to work on it")
    const gate = deferred<void>()
    server.state.writeGate = gate.promise
    const reads = () => server.staffCalls().filter((call) => call.method === "GET").length
    const readsBefore = reads()

    await user.dblClick(actionButton("Claim order"))
    expect(actionButton("Claiming…")).toBeDisabled()
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("Unassigned")
    expect(screen.queryByText("You claimed this order.")).not.toBeInTheDocument()
    await act(async () => gate.resolve())

    await screen.findByText("You claimed this order.")
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("Assigned to you")
    expect(actionButton("Record agreement")).toBeEnabled()
    expect(server.writes()).toHaveLength(1)
    expect(server.writes()[0]).toMatchObject({ method: "POST", body: undefined, credentials: "include" })
    expect(server.writes()[0].headers.get("X-CSRF-Token")).toBe("csrf-1")
    // The order is loaded again from the server, once.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(reads()).toBe(readsBefore + 1)
  })

  it("after claiming by keyboard, focus moves to the actions rather than nowhere", async () => {
    const { user } = await open("submitted", { holder: null })
    actionButton("Claim order").focus()
    await user.keyboard("{Enter}")
    await screen.findByText("You claimed this order.")
    // The button that was used is gone.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Actions" })).toHaveFocus())
  })

  it("when a colleague claimed it first, says so and shows who has it", async () => {
    const { server, order, user } = await open("submitted", { holder: null })
    server.staff.assign(order.id, member(BILAL))
    await user.click(actionButton("Claim order"))
    expect(await screen.findByText(/Someone else claimed this order first/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent(`Assigned to ${BILAL.name}`))
    expect(screen.queryByText("You claimed this order.")).not.toBeInTheDocument()
    expect(queryAction("Claim order")).not.toBeInTheDocument()
    expect(queryAction("Record agreement")).not.toBeInTheDocument()
    expect(actionButton("Record issue")).toBeEnabled()
    expect(server.writes()).toHaveLength(1)
  })

  it("releases only after confirmation", async () => {
    const { server, user } = await open("confirmed")
    await user.click(actionButton("Release order"))
    await submit(user, "Back")
    await closed()
    expect(server.writes()).toEqual([])

    await user.click(actionButton("Release order"))
    await submit(user, "Release order")
    await closed()
    await waitFor(() => expect(actionButton("Claim order")).toBeEnabled())
    expect(posts(server)).toEqual(["release"])
  })

  it("a Super Admin may act on, and release, a colleague's order; a Moderator may not", async () => {
    await open("confirmed", { who: OWNER, holder: BILAL })
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("As Super Admin you can still act on it")
    for (const name of ["Start preparing", "Release order", "Cancel order"]) expect(actionButton(name)).toBeEnabled()
  })

  it("a Moderator sees a colleague's order but is offered only an issue", async () => {
    await open("confirmed", { holder: BILAL })
    const panel = screen.getByRole("region", { name: "Actions" })
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Record issue"])
    expect(screen.getByRole("link", { name: `All orders held by ${BILAL.name}` })).toHaveAttribute(
      "href",
      `/admin/grocery?status=all&by=${BILAL.id}`
    )
  })
})

describe("recording the customer's agreement", () => {
  it("chooses nothing for the staff member", async () => {
    const { server, user } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    const form = await dialog()
    expect(form).toHaveTextContent("It is not an approval given by the customer in the app")
    for (const option of within(form).getAllByRole("radio")) expect(option).not.toBeChecked()
    expect(checkbox()).not.toBeChecked()
    expect(field(/^Items \(Rs\)/)).toHaveValue("")
    expect(field(/^Total the customer agreed to/)).toHaveValue("")

    await submit(user, "Confirm order")
    expect(form).toHaveTextContent("Choose how the customer agreed.")
    expect(form).toHaveTextContent("Say whether the customer agreed to any substitute.")
    expect(form).toHaveTextContent("Record an agreement only after the customer has agreed.")
    expect(field(/^Items \(Rs\)/)).toHaveFocus()
    expect(server.writes()).toEqual([])
  })

  it("each of the three declarations is required on its own", async () => {
    const { server, user } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    await dialog()
    await fillAgreement(user, { items: "100", service: "0", delivery: "0", total: "100" })
    await user.click(radio("Phone call"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    expect(screen.getByRole("dialog")).toHaveTextContent("Say whether the customer agreed to any substitute.")
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    expect(screen.getByRole("dialog")).toHaveTextContent("Record an agreement only after the customer has agreed.")
    expect(server.writes()).toEqual([])
  })

  it("sends whole paisa, exactly as typed, with the declarations", async () => {
    const { server, user, current } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    await dialog()
    // 0.29 + 0.57 + 1.15 is where floating point goes wrong.
    await fillAgreement(user, { items: "1,850.29", service: "0.57", delivery: "1.15", total: "1852.01" })
    expect(within(screen.getByRole("dialog")).getByText("Rs 1,852.01", { selector: "span" })).toBeInTheDocument()
    await user.click(radio("In person"))
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    await closed()

    expect(lastBody(server)).toEqual({
      revision: 1,
      itemsSubtotalPaisa: 185_029,
      serviceFeePaisa: 57,
      deliveryFeePaisa: 115,
      agreedTotalPaisa: 185_201,
      customerAgreed: true,
      method: "in_person",
      substitutionsAgreed: false,
    })
    expect(current().status).toBe("confirmed")
    await waitFor(() => expect(status()).toHaveTextContent("Confirmed"))
    const record = screen.getByRole("region", { name: "Recorded agreements" })
    expect(record).toHaveTextContent("Latest agreement (no. 1)")
    expect(record).toHaveTextContent("Substitute agreedNo")
    expect(record).toHaveTextContent(`Recorded byYou`)
  })

  it("blocks a total that does not equal the parts, without a request", async () => {
    const { server, user } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    await dialog()
    await fillAgreement(user, { items: "100", service: "10", delivery: "10", total: "110" })
    await user.click(radio("Phone call"))
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    expect(screen.getByRole("dialog")).toHaveTextContent("This doesn't equal the items plus the fees (Rs 120).")
    expect(server.writes()).toEqual([])
  })

  it("an agreed substitute needs a note saying which", async () => {
    const { server, user } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    await dialog()
    await fillAgreement(user, { items: "100", service: "0", delivery: "0", total: "100" })
    await user.click(radio("Written message"))
    await user.click(radio("Yes, they agreed to a substitute"))
    await user.click(checkbox())
    await user.type(field(/^Which substitutes they agreed to/), "   ")
    await submit(user, "Confirm order")
    expect(screen.getByRole("dialog")).toHaveTextContent("Write which substitutes the customer agreed to.")
    expect(server.writes()).toEqual([])

    await user.type(field(/^Which substitutes they agreed to/), "Brown rice instead of basmati")
    await submit(user, "Confirm order")
    await closed()
    expect(lastBody(server)).toMatchObject({ substitutionsAgreed: true, consentNote: "Brown rice instead of basmati", serviceFeePaisa: 0 })
  })

  it("the server's order limit is shown from its code; the form stays and nothing changes", async () => {
    const { server, user, current } = await open("submitted")
    await user.click(actionButton("Record agreement"))
    await dialog()
    await fillAgreement(user, { items: "25000", service: "0", delivery: "0", total: "25000" })
    await user.click(radio("Phone call"))
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    expect(await within(screen.getByRole("dialog")).findByText(/above the largest order allowed/)).toBeInTheDocument()
    expect(screen.getByRole("dialog")).not.toHaveTextContent("server text")
    expect(field(/^Items \(Rs\)/)).toHaveValue("25000")
    expect(current().status).toBe("submitted")
    expect(server.writes()).toHaveLength(1)
  })

  it("a new agreement needs its own note and keeps the earlier one as history", async () => {
    const { server, user } = await open("submitted")
    server.staff.assign(server.store.orders[0].detail.id, member(SANA))
    await user.click(actionButton("Record agreement"))
    await dialog()
    await fillAgreement(user, { items: "1850", service: "100", delivery: "150", total: "2100" })
    await user.click(radio("Phone call"))
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Confirm order")
    await closed()

    await user.click(await within(screen.getByRole("region", { name: "Actions" })).findByRole("button", { name: "Record new agreement" }))
    await dialog()
    // The amounts start from the last record; every declaration starts empty again.
    expect(field(/^Items \(Rs\)/)).toHaveValue("1850")
    expect(field(/^Total the customer agreed to/)).toHaveValue("")
    for (const option of within(screen.getByRole("dialog")).getAllByRole("radio")) expect(option).not.toBeChecked()
    expect(checkbox()).not.toBeChecked()
    await user.clear(field(/^Items \(Rs\)/))
    await user.type(field(/^Items \(Rs\)/), "1900")
    await user.type(field(/^Total the customer agreed to/), "2150")
    await user.click(radio("Phone call"))
    await user.click(radio("No substitute was agreed"))
    await user.click(checkbox())
    await submit(user, "Record new agreement")
    expect(screen.getByRole("dialog")).toHaveTextContent("Write what the customer newly agreed to.")
    expect(posts(server)).toEqual(["confirm"])

    await user.type(field(/^What the customer newly agreed to/), "Price of rice went up")
    await submit(user, "Record new agreement")
    await closed()
    expect(lastBody(server)).toMatchObject({ revision: 2, agreedTotalPaisa: 215_000, consentNote: "Price of rice went up" })
    const record = screen.getByRole("region", { name: "Recorded agreements" })
    await waitFor(() => expect(record).toHaveTextContent("Latest agreement (no. 2)"))
    expect(record).toHaveTextContent("Earlier agreement (no. 1)")
    expect(record).toHaveTextContent("Rs 2,100")
    expect(record).toHaveTextContent("Rs 2,150")
  })
})

describe("revision conflicts", () => {
  it("a change made on an old revision is refused; the latest order is loaded and explained", async () => {
    const { server, order, user } = await open("confirmed")
    await user.click(actionButton("Start preparing"))
    await dialog()
    server.store.staffReduce(order.id, 150_000) // someone else changed the order
    await submit(user, "Start preparing")
    await closed()
    const notice = await screen.findByText(/This order changed since you opened it/)
    await waitFor(() => expect(notice.closest("[tabindex='-1']")).toHaveFocus())
    await waitFor(() => expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Rs 1,500"))
    expect(status()).toHaveTextContent("Confirmed")
    expect(server.store.orders[0].detail.status).toBe("confirmed")
    expect(posts(server)).toEqual(["start-preparing"])
  })

  it("returning loads nothing, and a form left open while the order changed can't apply it", async () => {
    const { server, order, user } = await open("out_for_delivery")
    await user.click(actionButton("Record delivery and cash"))
    await dialog()
    await user.type(field(/^Cash you collected/), "2100")
    await user.click(checkbox())
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000)
    server.store.staffReduce(order.id, 150_000)
    const reads = server.staffCalls().length
    act(returnToTab)
    await act(() => new Promise((done) => setTimeout(done, 60)))
    expect(server.staffCalls()).toHaveLength(reads)

    // The screen is out of date; the server's version check is what stops the change.
    await submit(user, "Record delivered and paid")
    await closed()
    await screen.findByText(/This order changed since you opened it/)
    await waitFor(() => expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Rs 1,500"))
    expect(server.store.orders[0].detail.status).toBe("out_for_delivery")
    expect(posts(server)).toEqual(["complete"])
  })

  it("an order that moved on is explained, with the actions that now apply", async () => {
    const { server, order, user } = await open("preparing")
    await user.click(actionButton("Send out for delivery"))
    await dialog()
    server.store.staffMove(order.id, "out_for_delivery")
    await submit(user, "Out for delivery")
    await closed()
    await screen.findByText(/This order has moved on/)
    await waitFor(() => expect(actionButton("Record delivery and cash")).toBeEnabled())
  })
})

describe("lowering the amount", () => {
  it("only goes down, with a reason", async () => {
    const { server, user } = await open("confirmed")
    await user.click(actionButton("Lower amount due"))
    await dialog()
    await user.type(field(/^New amount due/), "2100")
    await submit(user, "Lower amount")
    expect(screen.getByRole("dialog")).toHaveTextContent("Enter less than the amount now due, Rs 2,100.")
    expect(screen.getByRole("dialog")).toHaveTextContent("Write why the amount is lower.")
    expect(server.writes()).toEqual([])

    await user.clear(field(/^New amount due/))
    await user.type(field(/^New amount due/), "1999.50")
    expect(screen.getByRole("dialog")).toHaveTextContent("This lowers the amount by Rs 100.50.")
    await user.type(field(/^Reason/), "Eggs weren't available")
    await submit(user, "Lower amount")
    await closed()
    expect(lastBody(server)).toEqual({ revision: 2, finalAmountPaisa: 199_950, reason: "Eggs weren't available" })
    const money = screen.getByRole("region", { name: "Amount due and payment" })
    await waitFor(() => expect(money).toHaveTextContent("Rs 1,999.50 (lowered after the agreement)"))
    expect(screen.getByRole("region", { name: "Staff notes and issues" })).toHaveTextContent("You lowered the amount from Rs 2,100 to Rs 1,999.50")
  })
})

describe("preparation, delivery and cash", () => {
  it("goes confirmed → preparing → out → failed → preparing → out → delivered and paid", async () => {
    const { server, user, current } = await open("confirmed")
    const step = async (action: string, send: string, fill?: () => Promise<void>) => {
      await user.click(await within(screen.getByRole("region", { name: "Actions" })).findByRole("button", { name: action }))
      await dialog()
      await fill?.()
      await submit(user, send)
      await closed()
    }
    await step("Start preparing", "Start preparing")
    await step("Send out for delivery", "Out for delivery", () => user.type(field(/^Dispatch note/), "Ali is carrying it"))
    expect(lastBody(server)).toEqual({ revision: 3, note: "Ali is carrying it" })

    await user.click(await within(screen.getByRole("region", { name: "Actions" })).findByRole("button", { name: "Record failed delivery" }))
    await dialog()
    await submit(user, "Record failed delivery")
    expect(screen.getByRole("dialog")).toHaveTextContent("Write why the delivery didn't complete.")
    await user.type(field(/^Reason/), "Nobody home")
    await submit(user, "Record failed delivery")
    await closed()
    await waitFor(() => expect(status()).toHaveTextContent("Preparing"))
    const attempts = screen.getByRole("region", { name: "Delivery attempts" })
    expect(attempts).toHaveTextContent("Attempt 1: Failed")
    expect(attempts).toHaveTextContent("Reason: Nobody home")
    expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Not collected")

    await step("Send out for delivery", "Out for delivery")
    await step("Record delivery and cash", "Record delivered and paid", async () => {
      await user.type(field(/^Cash you collected/), "2,100")
      await user.click(checkbox())
    })
    expect(lastBody(server)).toEqual({ revision: 6, amountCollectedPaisa: 210_000 })
    await waitFor(() => expect(status()).toHaveTextContent("Delivered"))
    expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Cash collected: Rs 2,100")
    expect(current().status).toBe("delivered")
    expect(posts(server)).toEqual(["start-preparing", "dispatch", "delivery-failed", "dispatch", "complete"])
    expect(within(screen.getByRole("region", { name: "Actions" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Record issue"])
  })

  it("asks for the cash counted, refuses a different figure, and needs the handover confirmed", async () => {
    const { server, user } = await open("out_for_delivery")
    await user.click(actionButton("Record delivery and cash"))
    await dialog()
    expect(field(/^Cash you collected/)).toHaveValue("")
    expect(checkbox()).not.toBeChecked()
    for (const wrong of ["2000", "2100.01", "2200"]) {
      await user.clear(field(/^Cash you collected/))
      await user.type(field(/^Cash you collected/), wrong)
      await submit(user, "Record delivered and paid")
      expect(screen.getByRole("dialog")).toHaveTextContent("The cash must equal the amount due, Rs 2,100.")
    }
    await user.clear(field(/^Cash you collected/))
    await user.type(field(/^Cash you collected/), "2100")
    await submit(user, "Record delivered and paid")
    expect(screen.getByRole("dialog")).toHaveTextContent("Record this only after the order was handed over")
    expect(server.writes()).toEqual([])
  })

  it("shows nothing as paid or delivered until the server answers", async () => {
    const { server, user } = await open("out_for_delivery")
    const gate = deferred<void>()
    server.state.writeGate = gate.promise
    await user.click(actionButton("Record delivery and cash"))
    await dialog()
    await user.type(field(/^Cash you collected/), "2100")
    await user.click(checkbox())
    await submit(user, "Record delivered and paid")

    const form = screen.getByRole("dialog")
    expect(within(form).getByRole("button", { name: "Recording…" })).toBeDisabled()
    expect(within(form).getByRole("button", { name: "Back" })).toBeDisabled()
    await user.keyboard("{Escape}")
    await user.type(field(/^Cash you collected/), "{Enter}{Enter}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByText("Delivery and cash recorded.")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("Cash collected:")

    await act(async () => gate.resolve())
    await closed()
    await screen.findByText("Delivery and cash recorded.")
    expect(server.writes()).toHaveLength(1)
  })
})

describe("cancelling", () => {
  it.each(["submitted", "confirmed"] as const)("a holder cancels a %s order with a reason", async (stage) => {
    const { server, user } = await open(stage)
    await user.click(actionButton("Cancel order"))
    await dialog()
    expect(within(screen.getByRole("dialog")).queryByRole("checkbox")).not.toBeInTheDocument()
    await submit(user, "Cancel this order")
    expect(screen.getByRole("dialog")).toHaveTextContent("Write why the order is being cancelled.")
    await user.type(field(/^Reason/), "Customer asked by phone")
    await submit(user, "Cancel this order")
    await closed()
    expect(lastBody(server)).toEqual({ revision: stage === "submitted" ? 1 : 2, reason: "Customer asked by phone" })
    await waitFor(() => expect(status()).toHaveTextContent("Cancelled"))
  })

  it("a Moderator cannot cancel while preparing, and is told why", async () => {
    await open("preparing")
    expect(queryAction("Cancel order")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("Only a Super Admin can cancel once preparation has started")
  })

  it("a Super Admin must acknowledge that goods may be bought; an issue is left behind", async () => {
    const { server, user } = await open("preparing", { who: OWNER, holder: SANA })
    await user.click(actionButton("Cancel order"))
    await dialog()
    await user.type(field(/^Reason/), "Shop closed")
    expect(checkbox()).not.toBeChecked()
    await submit(user, "Cancel this order")
    expect(screen.getByRole("dialog")).toHaveTextContent("Confirm that goods may already have been bought.")
    expect(server.writes()).toEqual([])
    await user.click(checkbox())
    await submit(user, "Cancel this order")
    await closed()
    expect(lastBody(server)).toEqual({ revision: 3, reason: "Shop closed", procurementAcknowledged: true })
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Staff notes and issues" })).toHaveTextContent("Cancelled after buying may have started")
    )
  })

  it("nobody cancels while out for delivery; the failed delivery comes first", async () => {
    await open("out_for_delivery", { who: OWNER })
    expect(queryAction("Cancel order")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("first record this delivery as failed")
  })

  it("the server's 'Super Admin only' answer is explained when preparation started underneath", async () => {
    const { server, order, user } = await open("confirmed")
    await user.click(actionButton("Cancel order"))
    await dialog()
    await user.type(field(/^Reason/), "Customer asked")
    server.store.staffMove(order.id, "preparing")
    await submit(user, "Cancel this order")
    await closed()
    await screen.findByText(/Only a Super Admin can do this now/)
    await waitFor(() => expect(status()).toHaveTextContent("Preparing"))
    expect(server.store.orders[0].detail.status).toBe("preparing")
  })
})

describe("recording an issue", () => {
  it("needs a kind and a note, sends no revision, and works on a finished order held by nobody", async () => {
    const server = fakeStaffServer(SANA)
    const order = server.store.seed(CUSTOMER_KEY)
    server.store.staffCancel(order.id)
    const { user } = renderStaffApp(`/admin/grocery/${order.id}`)
    await heading(`Order ${order.reference}`)
    await user.click(actionButton("Record issue"))
    await dialog()
    for (const option of within(screen.getByRole("dialog")).getAllByRole("radio")) expect(option).not.toBeChecked()
    expect(within(screen.getByRole("dialog")).queryByRole("radio", { name: /after buying/i })).not.toBeInTheDocument()
    await submit(user, "Record issue")
    expect(screen.getByRole("dialog")).toHaveTextContent("Choose what kind of issue it is.")
    await user.click(radio("Customer unreachable"))
    await user.type(field(/^What happened/), "Phone switched off")
    await submit(user, "Record issue")
    await closed()
    expect(lastBody(server)).toEqual({ kind: "customer_unreachable", note: "Phone switched off" })
    const log = screen.getByRole("region", { name: "Staff notes and issues" })
    await waitFor(() => expect(log).toHaveTextContent("You recorded an issue: Customer unreachable"))
    expect(log).toHaveTextContent("Phone switched off")
  })
})

describe("when the outcome is unknown, nothing is sent again and nothing is assumed", () => {
  async function sendCompletion(user: UserEvent) {
    await user.click(actionButton("Record delivery and cash"))
    await dialog()
    await user.type(field(/^Cash you collected/), "2100")
    await user.click(checkbox())
    await submit(user, "Record delivered and paid")
    await closed()
  }

  it("no answer, and the order can't be reloaded: every action waits for a fresh copy", async () => {
    const { server, user } = await open("out_for_delivery")
    server.state.writeFaults.push("lost-before")
    server.state.readsFail = "network"
    await sendCompletion(user)

    await screen.findByText(/We don't know whether the delivery and cash was saved/)
    for (const button of within(screen.getByRole("region", { name: "Actions" })).getAllByRole("button")) {
      expect(button).toBeDisabled()
    }
    expect(document.body).not.toHaveTextContent("Cash collected:")
    expect(screen.queryByText("Delivery and cash recorded.")).not.toBeInTheDocument()
    expect(server.writes()).toHaveLength(1)

    server.state.readsFail = null
    await user.click(await screen.findByRole("button", { name: "Load the order again" }))
    await screen.findByText(/Check whether the delivery and cash was saved/)
    expect(actionButton("Record delivery and cash")).toBeEnabled()
    expect(status()).toHaveTextContent("Out for delivery")
    expect(server.writes()).toHaveLength(1)
  })

  it.each(["lost-after", "error-after"] as const)("%s: the reload shows what the server really holds", async (fault) => {
    const { server, user } = await open("out_for_delivery")
    server.state.writeFaults.push(fault)
    await sendCompletion(user)
    await screen.findByText(/Check whether the delivery and cash was saved/)
    await waitFor(() => expect(status()).toHaveTextContent("Delivered"))
    expect(screen.getByRole("region", { name: "Amount due and payment" })).toHaveTextContent("Cash collected: Rs 2,100")
    expect(screen.queryByText("Delivery and cash recorded.")).not.toBeInTheDocument()
    expect(server.writes()).toHaveLength(1)
  })

  describe("a request that never answers", () => {
    afterEach(() => vi.useRealTimers())

    it("is given up after the time limit and treated as unknown", async () => {
      const { server, user } = await open("submitted", { holder: null })
      const real = globalThis.fetch
      let aborted = false
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>((_, reject) => {
              init.signal?.addEventListener("abort", () => {
                aborted = true
                reject(new DOMException("aborted", "AbortError"))
              })
            })
          : real(input, init)
      )
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await user.click(actionButton("Claim order"))
      await act(() => vi.advanceTimersByTimeAsync(STAFF_WRITE_TIMEOUT_MS - 1_000))
      expect(aborted).toBe(false)
      expect(actionButton("Claiming…")).toBeDisabled()
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(aborted).toBe(true)
      await screen.findByText(/whether your claim was saved/)
      expect(server.writes()).toEqual([]) // the stub swallowed it; nothing else was sent either
    })
  })

  it("leaving and reopening the order while a change is on its way offers no second send", async () => {
    const { server, order, user, router } = await open("submitted", { holder: null })
    const gate = deferred<void>()
    server.state.writeGate = gate.promise
    await user.click(actionButton("Record issue"))
    await dialog()
    await user.click(radio("Other"))
    await user.type(field(/^What happened/), "Slow network")
    await submit(user, "Record issue")
    await act(() => router.navigate("/admin/grocery"))
    await heading("Grocery orders")
    await act(() => router.navigate(`/admin/grocery/${order.id}`))
    await heading(`Order ${order.reference}`)
    expect(actionButton("Record issue")).toBeDisabled()
    await act(async () => gate.resolve())
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Staff notes and issues" })).toHaveTextContent("Slow network")
    )
    expect(actionButton("Record issue")).toBeEnabled()
    expect(server.writes()).toHaveLength(1)
  })
})

describe("refusals that keep the form open", () => {
  it("too many staff changes: says to wait, keeps what was typed, sends nothing again", async () => {
    const { server, user } = await open("preparing")
    server.staff.rateLimited = true
    await user.click(actionButton("Send out for delivery"))
    await dialog()
    await user.type(field(/^Dispatch note/), "Ali")
    await submit(user, "Out for delivery")
    await within(screen.getByRole("dialog")).findByText(/Too many staff changes/)
    expect(field(/^Dispatch note/)).toHaveValue("Ali")
    expect(server.writes()).toHaveLength(1)
  })

  it("offline: nothing is sent, and the screen says it is offline", async () => {
    const { server, user } = await open("submitted", { holder: null })
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    act(() => void window.dispatchEvent(new Event("offline")))
    expect(screen.getByText(/You're offline\. What's shown may be out of date/)).toBeInTheDocument()
    await user.click(actionButton("Claim order"))
    await screen.findByText("You're offline. Reconnect to make changes.")
    expect(server.writes()).toEqual([])
    online.mockRestore()
  })

  it("a failed refresh keeps the last order on screen and says so", async () => {
    const { server, user } = await open("confirmed")
    server.state.readsFail = "server"
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText(/Couldn't refresh/)
    expect(document.body).toHaveTextContent("House 17, Street 4")
  })
})

describe("verified payments and refunds (GROCERY-4C)", () => {
  const money = () => screen.getByRole("region", { name: "Amount due and payment" })
  const actionNames = () =>
    within(screen.getByRole("region", { name: "Actions" })).getAllByRole("button").map((b) => b.textContent)

  async function openPayable(stage: Stage, options: { who?: Account; holder?: Account | null } = {}) {
    const opened = await open(stage, options)
    opened.server.store.paymentMethods = ["cash_on_delivery", "card", "easypaisa"]
    await opened.user.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(actionButton("Record payment")).toBeEnabled())
    return opened
  }

  async function start(user: UserEvent, action: string) {
    await user.click(await within(screen.getByRole("region", { name: "Actions" })).findByRole("button", { name: action }))
    await dialog()
  }

  const tick = (user: UserEvent, name: RegExp) =>
    user.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name }))

  async function recordPayment(user: UserEvent, reference = "EP 7788-9900") {
    await start(user, "Record payment")
    await user.click(radio("Easypaisa"))
    await user.type(field(/^Amount received/), "2100")
    await user.type(field(/^Transaction reference/), reference)
    await tick(user, /I checked that this money was received/)
    await submit(user, "Record payment")
  }

  it("with only cash switched on there is nothing to record before delivery", async () => {
    await open("confirmed")
    expect(queryAction("Record payment")).not.toBeInTheDocument()
    expect(money()).toHaveTextContent("Not collected. Cash on delivery.")
  })

  it("records a verified payment once, offering only switched-on methods, and delivers nothing", async () => {
    const { server, user, current } = await openPayable("confirmed")
    expect(money()).toHaveTextContent("Not paid yet.")
    await start(user, "Record payment")
    expect(within(screen.getByRole("dialog")).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "Card",
      "Easypaisa",
    ])

    await user.type(field(/^Amount received/), "2000")
    await submit(user, "Record payment")
    const form = screen.getByRole("dialog")
    for (const problem of [
      "Choose how the customer paid.",
      "Enter exactly Rs 2,100. Part payments can't be recorded.",
      "Enter the transaction reference.",
      "Record a payment only after checking the money was received.",
    ]) {
      expect(form).toHaveTextContent(problem)
    }
    expect(server.writes()).toEqual([])
    await user.keyboard("{Escape}")
    await closed()

    await recordPayment(user)
    await closed()
    await screen.findByText("Payment recorded. The order's status didn't change.")
    expect(server.writes()).toHaveLength(1)
    expect(lastBody(server)).toEqual({
      revision: 2,
      method: "easypaisa",
      amountPaisa: 210_000,
      reference: "EP 7788-9900",
      moneyVerified: true,
    })
    await waitFor(() => expect(money()).toHaveTextContent("Paid with Easypaisa: Rs 2,100"))
    expect(money()).toHaveTextContent("Reference: EP77889900")
    expect(money()).toHaveTextContent("Verified by You")
    expect(current().status).toBe("confirmed")
    expect(actionNames()).toEqual(["Start preparing", "Release order", "Record issue"])
    expect(screen.getByRole("region", { name: "Actions" })).toHaveTextContent("Only a Super Admin can record a refund")
  })

  it("a paid order is delivered without collecting cash again", async () => {
    const { server, user } = await openPayable("out_for_delivery")
    await recordPayment(user)
    await closed()
    await waitFor(() => expect(actionButton("Record delivery")).toBeEnabled())
    expect(queryAction("Record delivery and cash")).not.toBeInTheDocument()

    await start(user, "Record delivery")
    expect(screen.getByRole("dialog")).toHaveTextContent("This order is already paid: collect nothing.")
    expect(within(screen.getByRole("dialog")).queryByLabelText(/Cash you collected/)).not.toBeInTheDocument()
    await tick(user, /The order was handed over/)
    await submit(user, "Record delivered")
    await closed()

    await screen.findByText("Delivery recorded.")
    expect(lastBody(server)).toEqual({ revision: 5 })
    await waitFor(() => expect(status()).toHaveTextContent("Delivered"))
    expect(money()).toHaveTextContent("Paid with Easypaisa: Rs 2,100")
  })

  it("a card number is refused by the server and never shown back", async () => {
    const { server, user } = await openPayable("confirmed")
    await recordPayment(user, "4111 1111 1111 1111")

    await within(screen.getByRole("dialog")).findByText(/That looks like a card number/)
    expect(document.querySelector('[role="alert"]')!.textContent).not.toContain("4111")
    expect(server.writes()).toHaveLength(1)
    expect(server.store.orders[0].detail.payment?.status).toBe("due")
  })

  it("only a Super Admin is offered the refund, which cancels an undelivered order once", async () => {
    const { server, user, current } = await openPayable("preparing", { who: OWNER, holder: null })
    await recordPayment(user)
    await closed()
    await waitFor(() => expect(actionButton("Record refund")).toBeEnabled())
    expect(queryAction("Cancel order")).not.toBeInTheDocument()

    await start(user, "Record refund")
    expect(screen.getByRole("dialog")).toHaveTextContent("This app returns no money")
    expect(screen.getByRole("dialog")).toHaveTextContent("This also cancels the order.")
    await submit(user, "Record refund and cancel order")
    for (const problem of [
      "Choose how the money was returned.",
      "Write why the payment was refunded.",
      "Record a refund only after the money has been returned.",
      "Confirm that goods may already have been bought.",
    ]) {
      expect(screen.getByRole("dialog")).toHaveTextContent(problem)
    }
    expect(server.writes()).toHaveLength(1) // only the payment

    await user.type(field(/^Amount returned/), "2100")
    await user.click(radio("Cash"))
    await user.type(field(/^Reason/), "Shop was closed")
    await tick(user, /whole amount has been returned/)
    await tick(user, /goods may already have been bought/)
    await submit(user, "Record refund and cancel order")
    await closed()

    await screen.findByText("Refund recorded.")
    expect(lastBody(server)).toEqual({
      revision: 4,
      amountPaisa: 210_000,
      method: "cash",
      reason: "Shop was closed",
      moneyReturned: true,
      procurementAcknowledged: true,
    })
    await waitFor(() => expect(status()).toHaveTextContent("Cancelled"))
    expect(money()).toHaveTextContent("Paid with Easypaisa: Rs 2,100") // the payment is kept
    expect(money()).toHaveTextContent("Refunded: Rs 2,100, in cash")
    expect(money()).toHaveTextContent("Reason: Shop was closed")
    expect(queryAction("Record refund")).not.toBeInTheDocument()
    expect(current().status).toBe("cancelled")
    expect(posts(server)).toEqual(["record-payment", "refund"])
  })

  it("a payment recorded elsewhere meanwhile is explained, and nothing is sent twice", async () => {
    const { server, user, order } = await openPayable("confirmed", { who: OWNER, holder: null })
    await start(user, "Record payment")
    await user.click(radio("Card"))
    await user.type(field(/^Amount received/), "2100")
    await user.type(field(/^Transaction reference/), "SLIP-001")
    await tick(user, /I checked/)
    // the same order is paid from another screen first
    const me = { id: OWNER.id, displayName: OWNER.name, ownerKey: OWNER.id, superAdmin: true, groceryScope: false, emailVerified: true }
    server.staff.route(
      "POST",
      `/admin/grocery/orders/${order.id}/record-payment`,
      new URLSearchParams(),
      { revision: 2, method: "easypaisa", amountPaisa: 210_000, reference: "EP-1111", moneyVerified: true },
      me
    )
    await submit(user, "Record payment")

    await screen.findByText(/This order is already paid|This order changed since you opened it/)
    await closed()
    await waitFor(() => expect(money()).toHaveTextContent("Paid with Easypaisa: Rs 2,100"))
    expect(server.writes()).toHaveLength(1)
  })
})
