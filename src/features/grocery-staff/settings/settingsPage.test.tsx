import { act, screen, waitFor, within } from "@testing-library/react"
import type { UserEvent } from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { dialog, fakeAdminServer, heading, inDialog, renderAdminApp, type FakeAdminServer } from "@/test/adminHarness"
import { deferred } from "@/test/apiMock"

const PATH = "/admin/grocery/settings"
const section = (name: string) => screen.getByRole("region", { name })
const field = (label: string | RegExp) => screen.getByLabelText(label)
const bar = () => screen.getByRole("region", { name: "Unsaved changes" })
const noBar = () => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument()

async function openSettings(server: FakeAdminServer = fakeAdminServer()) {
  const app = renderAdminApp(PATH)
  await heading("Grocery settings")
  return { server, ...app }
}

async function setNumber(user: UserEvent, label: RegExp, value: string) {
  await user.clear(field(label))
  if (value) await user.type(field(label), value)
}

async function addBlock(user: UserEvent, name: string) {
  await user.type(field("Add a block"), name)
  await user.click(screen.getByRole("button", { name: "Add" }))
}

async function review(user: UserEvent) {
  await user.click(within(bar()).getByRole("button", { name: "Review changes" }))
  return dialog()
}

const send = (user: UserEvent) => user.click(inDialog().getByRole("button", { name: "Save settings" }))
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

describe("loading the settings", () => {
  it("shows the server's safe defaults: off, no block, nobody recorded, nothing unsaved", async () => {
    const { server } = await openSettings()
    const savedNow = section("Saved now")
    expect(savedNow).toHaveTextContent("Ordering is switched off")
    expect(savedNow).toHaveTextContent(/Version 1, saved 20 Nov 2026.*No person is recorded for this version\./)
    expect(savedNow).toHaveTextContent("earlier versions can't be shown here")
    expect(field("Accept new grocery orders")).not.toBeChecked()
    expect(section("Delivery coverage")).toHaveTextContent("No block is listed, so nobody can order.")
    expect(section("Delivery coverage")).not.toHaveTextContent(/Block [A-Z]\b/)
    expect(field(/^Orders accepted per day/)).toHaveValue("10")
    expect(field(/^Largest order total/)).toHaveValue("20000")
    expect(field("Opens at")).toHaveValue("10:00")
    expect(section("Operating schedule")).toHaveTextContent("Pakistan time (Asia/Karachi), which can't be changed")
    expect(screen.queryByLabelText(/time zone/i)).not.toBeInTheDocument()
    noBar()
    expect(server.adminCalls().map((c) => `${c.method} ${c.path}`)).toEqual(["GET /admin/grocery/settings"])
    expect(server.writes()).toEqual([])
  })

  it("names who saved a later version", async () => {
    const server = fakeAdminServer()
    server.admin.saveElsewhere({ dailyCapacity: 11 }, "Zara Superadmin")
    await openSettings(server)
    expect(section("Saved now")).toHaveTextContent(/Version 2, saved .* by Zara Superadmin\./)
  })

  it("a failed load is an error with a retry, never a form of guesses", async () => {
    const server = fakeAdminServer()
    server.state.readsFail = "network"
    const { user } = renderAdminApp(PATH)
    await heading("Couldn't load the grocery settings")
    expect(screen.queryByRole("form")).not.toBeInTheDocument()
    server.state.readsFail = null
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await heading("Grocery settings")
  })
})

describe("a refused read", () => {
  it("drops the settings already on screen, even while the account still looks the same", async () => {
    const server = fakeAdminServer()
    server.admin.saveElsewhere({ serviceableBlocks: ["Private Test Block"] })
    const { user } = await openSettings(server)
    server.state.readsRefused = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Couldn't load the grocery settings")
    expect(document.body).not.toHaveTextContent("Private Test Block")
  })
})

describe("who may see the settings", () => {
  it.each(["Sana Grocer", "Farah Food", "Pia Paused", "Rafi Resident"])("%s is refused and no admin request is made", async (name) => {
    const server = fakeAdminServer(name)
    renderAdminApp(PATH)
    await heading("Admin access only")
    expect(server.adminCalls()).toEqual([])
  })

  it("signed out: the staff sign-in, with the way back, and no admin request", async () => {
    const server = fakeAdminServer(null)
    const { router } = renderAdminApp(PATH)
    await heading("Admin Login")
    expect(router.state.location.state).toEqual({ from: PATH })
    expect(server.adminCalls()).toEqual([])
  })
})

describe("editing", () => {
  it("marks each unsaved field beside the saved value, and going back to it clears the mark", async () => {
    const { user, server } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "25")
    expect(section("Capacity and order limits")).toHaveTextContent("Not saved yet. Saved now: 10")
    expect(bar()).toHaveTextContent("1 unsaved change")
    await setNumber(user, /^Orders accepted per day/, "10")
    noBar()
    expect(server.writes()).toEqual([])
  })

  it("adds and removes blocks; Enter adds and never saves", async () => {
    const { user, server } = await openSettings()
    await user.type(field("Add a block"), "Test Block A{Enter}")
    await addBlock(user, "Test Block B")
    const list = screen.getByRole("list", { name: "Listed delivery blocks" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(field("Add a block")).toHaveFocus()
    await addBlock(user, "test block a")
    expect(section("Delivery coverage")).toHaveTextContent("That block is already listed.")
    await user.click(screen.getByRole("button", { name: "Remove block Test Block A" }))
    expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    expect(server.writes()).toEqual([])
  })

  it("refuses invalid values before anything is sent, and goes to the first one", async () => {
    const { user, server } = await openSettings()
    for (let day = 0; day < 7; day += 1) {
      await user.click(screen.getByRole("checkbox", { name: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day] }))
    }
    await setNumber(user, /^Orders accepted per day/, "500")
    await setNumber(user, /^Largest order total/, "0")
    await user.click(within(bar()).getByRole("button", { name: "Review changes" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(section("Operating schedule")).toHaveTextContent("Choose at least one day.")
    expect(section("Capacity and order limits")).toHaveTextContent("Enter a whole number from 1 to 200.")
    expect(section("Financial limit")).toHaveTextContent("Enter rupees from Rs 1 to Rs 1,000,000")
    expect(document.activeElement?.id).toMatch(/operatingDays$/)
    expect(server.writes()).toEqual([])
  })

  it("closing must be after opening", async () => {
    const { user, server } = await openSettings()
    await user.clear(field("Closes at"))
    await user.type(field("Closes at"), "09:00")
    await user.click(within(bar()).getByRole("button", { name: "Review changes" }))
    expect(section("Operating schedule")).toHaveTextContent("The closing time must be after the opening time.")
    expect(server.writes()).toEqual([])
  })
})

describe("saving", () => {
  it("shows every change and its meaning, then sends only those with the version, once", async () => {
    const { user, server } = await openSettings()
    await addBlock(user, "Test Block A")
    await setNumber(user, /^Largest order total/, "25000.50")
    const form = await review(user)
    const changes = within(form).getByText("Delivery blocks").closest("dl")!
    expect(changes).toHaveTextContent("Delivery blocksNone → changes to Test Block A")
    expect(changes).toHaveTextContent("Largest order totalRs 20,000 → changes to Rs 25,000.50")
    expect(within(form).getByRole("list", { name: "What this means" })).toHaveTextContent("including for orders that already exist")
    expect(within(form).queryByRole("checkbox")).not.toBeInTheDocument()
    await user.dblClick(inDialog().getByRole("button", { name: "Save settings" }))
    await closed()
    await screen.findByText("Settings saved. Version 2.")
    expect(server.writes()).toHaveLength(1)
    expect(server.writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/admin/grocery/settings",
      body: { revision: 1, serviceableBlocks: ["Test Block A"], maxOrderValuePaisa: 2_500_050 },
    })
    expect(server.writes()[0].headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(section("Saved now")).toHaveTextContent(/Version 2, saved .* by Omar Superadmin\./)
    noBar()
    expect(server.admin.settings.enabled).toBe(false)
  })

  it.each([
    [false, true, "Yes, switch grocery ordering ON."],
    [true, false, "Yes, switch grocery ordering OFF."],
  ])("switching ordering from %s needs its own confirmation", async (was, becomes, label) => {
    const server = fakeAdminServer()
    if (was) server.admin.saveElsewhere({ enabled: true, serviceableBlocks: ["Test Block A"] })
    const { user } = await openSettings(server)
    await user.click(field("Accept new grocery orders"))
    await review(user)
    expect(inDialog().getByRole("checkbox", { name: label })).not.toBeChecked()
    await send(user)
    expect(screen.getByRole("dialog")).toHaveTextContent("Confirm that you mean to switch ordering.")
    expect(server.writes()).toEqual([])
    await user.click(inDialog().getByRole("checkbox", { name: label }))
    await send(user)
    await closed()
    expect(server.writes()[0].body).toMatchObject({ enabled: becomes })
  })

  it("backing out of the review saves nothing and keeps the edits", async () => {
    const { user, server } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "25")
    await review(user)
    await user.click(inDialog().getByRole("button", { name: "Back" }))
    await closed()
    expect(bar()).toHaveTextContent("1 unsaved change")
    expect(server.writes()).toEqual([])
  })

  it("shows nothing as saved until the server answers", async () => {
    const { user, server } = await openSettings()
    const gate = deferred<void>()
    server.state.writeGate = gate.promise
    await setNumber(user, /^Orders accepted per day/, "25")
    await review(user)
    await send(user)
    expect(inDialog().getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(inDialog().getByRole("button", { name: "Back" })).toBeDisabled()
    await user.keyboard("{Escape}{Enter}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByText(/Settings saved/)).not.toBeInTheDocument()
    await act(async () => gate.resolve())
    await closed()
    expect(server.writes()).toHaveLength(1)
  })

  it.each([
    ["too many changes", (s: FakeAdminServer) => (s.admin.settingsRateLimited = true), /Too many settings changes/],
  ])("a refusal (%s) keeps the review open and the edits", async (_label, arrange, message) => {
    const { user, server } = await openSettings()
    arrange(server)
    await setNumber(user, /^Orders accepted per day/, "25")
    await review(user)
    await send(user)
    await inDialog().findByText(message)
    expect(screen.getByRole("dialog")).not.toHaveTextContent("server text")
    expect(server.admin.settings.revision).toBe(1)
    expect(server.writes()).toHaveLength(1)
    await user.click(inDialog().getByRole("button", { name: "Back" }))
    await closed()
    expect(field(/^Orders accepted per day/)).toHaveValue("25")
  })
})

describe("another Super Admin changes the settings", () => {
  async function conflicted() {
    const { user, server } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "15")
    await setNumber(user, /^Items per order/, "20")
    await review(user)
    server.admin.saveElsewhere({ dailyCapacity: 30, opensAt: "09:00" })
    await send(user)
    await closed()
    const panel = await screen.findByRole("region", { name: /Version 2 was saved while you were editing version 1/ })
    return { user, server, panel }
  }

  it("saves nothing of mine, explains, and waits for a decision", async () => {
    const { server, panel } = await conflicted()
    expect(await screen.findByText(/Someone else changed the settings/)).toBeInTheDocument()
    expect(panel).toHaveTextContent("Orders per day: 10 → 30")
    expect(panel).toHaveTextContent("Opens at: 10:00 AM → 9:00 AM")
    expect(panel).toHaveTextContent("Orders per day: 15 (also changed on the server: keeping yours would replace it)")
    expect(panel).toHaveTextContent("Items per order: 20")
    noBar()
    expect(field(/^Items per order/)).toBeDisabled()
    expect(server.admin.settings).toMatchObject({ revision: 2, dailyCapacity: 30, maxItemsPerOrder: 50 })
    expect(server.writes()).toHaveLength(1)
  })

  it("keeping my edits sends nothing by itself; saving again sends only them on the new version", async () => {
    const { user, server, panel } = await conflicted()
    await user.click(within(panel).getByRole("button", { name: "Keep my edits on version 2" }))
    expect(field("Opens at")).toHaveValue("09:00") // theirs is kept
    expect(field(/^Orders accepted per day/)).toHaveValue("15")
    expect(server.writes()).toHaveLength(1)
    await review(user)
    await send(user)
    await closed()
    expect(server.writes()[1].body).toEqual({ revision: 2, dailyCapacity: 15, maxItemsPerOrder: 20 })
    expect(server.admin.settings).toMatchObject({ revision: 3, opensAt: "09:00" })
  })

  it("discarding shows the saved version", async () => {
    const { user, server, panel } = await conflicted()
    await user.click(within(panel).getByRole("button", { name: "Discard my edits" }))
    expect(field(/^Orders accepted per day/)).toHaveValue("30")
    expect(field(/^Items per order/)).toHaveValue("50")
    noBar()
    expect(server.writes()).toHaveLength(1)
  })

  it("returning loads nothing, and a review left open over a newer version can't overwrite it", async () => {
    const { user, server } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "15")
    await review(user)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000)
    server.admin.saveElsewhere({ opensAt: "09:00" })
    const reads = server.adminCalls().length
    act(() => void window.dispatchEvent(new Event("focus")))
    await act(() => new Promise((done) => setTimeout(done, 60)))
    expect(server.adminCalls()).toHaveLength(reads)

    // The server's version check stops it; the newer version is read and the person decides again.
    await send(user)
    await closed()
    await screen.findByRole("region", { name: /was saved while you were editing/ })
    expect(server.writes()).toHaveLength(1)
    expect(server.admin.settings).toMatchObject({ opensAt: "09:00", dailyCapacity: 10 })
  })

  it("with no edits, the newer version is simply shown", async () => {
    const { user, server } = await openSettings()
    server.admin.saveElsewhere({ dailyCapacity: 30 })
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(field(/^Orders accepted per day/)).toHaveValue("30"))
    expect(screen.queryByRole("region", { name: /was saved while you were editing/ })).not.toBeInTheDocument()
  })
})

describe("an unclear answer", () => {
  async function sendUnclear(fault: "lost-before" | "lost-after" | "error-after", readsFail = false) {
    const { user, server } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "25")
    await review(user)
    server.state.writeFaults.push(fault)
    if (readsFail) server.state.readsFail = "network"
    await send(user)
    await closed()
    return { user, server }
  }

  it("is never resent, and saving waits for a fresh copy", async () => {
    const { user, server } = await sendUnclear("lost-before", true)
    await screen.findByText(/We don't know whether your settings change was saved/)
    expect(within(bar()).getByRole("button", { name: "Review changes" })).toBeDisabled()
    expect(field(/^Orders accepted per day/)).toBeDisabled()
    expect(screen.queryByText(/Settings saved/)).not.toBeInTheDocument()
    server.state.readsFail = null
    await user.click(await screen.findByRole("button", { name: "Load the settings again" }))
    await screen.findByText(/Check whether your settings change was saved/)
    expect(field(/^Orders accepted per day/)).toHaveValue("25")
    expect(within(bar()).getByRole("button", { name: "Review changes" })).toBeEnabled()
    expect(server.writes()).toHaveLength(1)
  })

  it.each(["lost-after", "error-after"] as const)("%s: the reload shows the stored version, with nothing left unsaved", async (fault) => {
    const { server } = await sendUnclear(fault)
    await screen.findByText("Nothing is left unsaved", { exact: false })
    expect(section("Saved now")).toHaveTextContent("Version 2")
    expect(field(/^Orders accepted per day/)).toHaveValue("25")
    noBar()
    expect(server.writes()).toHaveLength(1)
  })
})

describe("unsaved edits", () => {
  it("leaving asks first; staying keeps them, discarding leaves", async () => {
    const { user, router } = await openSettings()
    await setNumber(user, /^Orders accepted per day/, "25")
    await user.click(screen.getByRole("link", { name: "Grocery queue" }))
    expect(await dialog()).toHaveTextContent("Leave without saving?")
    await user.click(inDialog().getByRole("button", { name: "Stay here" }))
    await closed()
    expect(router.state.location.pathname).toBe(PATH)
    expect(field(/^Orders accepted per day/)).toHaveValue("25")

    await user.click(screen.getByRole("link", { name: "Grocery queue" }))
    await dialog()
    await user.click(inDialog().getByRole("button", { name: "Discard and leave" }))
    await heading("Queue stand-in")
  })

  it("the browser asks before a reload only while something is unsaved", async () => {
    const { user } = await openSettings()
    const asked = () => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(asked()).toBe(false)
    await setNumber(user, /^Orders accepted per day/, "25")
    expect(asked()).toBe(true)
    await user.click(within(bar()).getByRole("button", { name: "Discard" }))
    expect(asked()).toBe(false)
  })
})

describe("losing the session or the account while editing", () => {
  const dirty = async () => {
    const app = await openSettings()
    await setNumber(app.user, /^Orders accepted per day/, "25")
    return app
  }

  it("an expired staff session closes the screen, without being held by the unsaved edits", async () => {
    const { user, server, router } = await dirty()
    server.state.staffSessionStale = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Admin Login")
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("logging out drops the edits", async () => {
    const { user } = await dirty()
    await user.click(within(screen.getByRole("navigation", { name: "Admin" })).getByRole("button", { name: "Log out" }))
    await heading("Admin Login")
  })

  it("another Super Admin signing in sees none of the first one's edits", async () => {
    const { server } = await dirty()
    server.signInAs("Zara Superadmin")
    act(() => void window.dispatchEvent(new Event("focus")))
    await waitFor(() => expect(field(/^Orders accepted per day/)).toHaveValue("10"))
    noBar()
    expect(server.writes()).toEqual([])
  })

  it("a save pressed after another tab switched accounts is not sent again as that person", async () => {
    const { user, server } = await dirty()
    await review(user)
    server.signInAs("Zara Superadmin")
    await send(user)
    await waitFor(() => expect(field(/^Orders accepted per day/)).toHaveValue("10"))
    expect(server.writes()).toHaveLength(1)
    expect(server.admin.settings.revision).toBe(1)
    noBar()
  })

  it("losing the Super Admin role closes the screen", async () => {
    const { user, server } = await dirty()
    await review(user)
    server.byName("Omar Superadmin").roles = []
    await send(user)
    await heading("Admin access only")
    expect(server.admin.settings.revision).toBe(1)
  })

  it("keeps nothing in browser storage", async () => {
    const { user } = await dirty()
    await addBlock(user, "Secret Test Block")
    const stored = JSON.stringify([{ ...localStorage }, { ...sessionStorage }])
    expect(stored).not.toContain("Secret Test Block")
    expect(window.location.search).toBe("")
  })
})

describe("all of B-17 and payment methods (GROCERY-4C)", () => {
  const COVERS = "The listed blocks cover all sectors and blocks of B-17"

  it("can't be confirmed with no block, is unticked by a new list, and is saved with the list", async () => {
    const { user, server } = await openSettings()
    expect(field(COVERS)).toBeDisabled()
    expect(field(COVERS)).not.toBeChecked()
    await addBlock(user, "Test Block A")
    await user.click(field(COVERS))
    await addBlock(user, "Test Block B")
    expect(field(COVERS)).not.toBeChecked()
    await user.click(field(COVERS))

    await review(user)
    expect(inDialog().getByRole("list", { name: "What this means" })).toHaveTextContent("all sectors and blocks of B-17")
    await send(user)
    await closed()

    expect(server.writes()[0].body).toEqual({
      revision: 1,
      serviceableBlocks: ["Test Block A", "Test Block B"],
      coversAllB17: true,
    })
    expect(server.admin.settings.coversAllB17).toBe(true)
  })

  it("switches methods on and off, with cash fixed on", async () => {
    const { user, server } = await openSettings()
    expect(field("Cash on delivery")).toBeChecked()
    expect(field("Cash on delivery")).toBeDisabled()
    for (const name of ["Card", "Bank transfer", "Easypaisa", "JazzCash"]) expect(field(name)).not.toBeChecked()

    await user.click(field("Easypaisa"))
    await review(user)
    await send(user)
    await closed()

    expect(server.writes()[0].body).toEqual({ revision: 1, paymentMethods: ["cash_on_delivery", "easypaisa"] })
    expect(field("Easypaisa")).toBeChecked()
  })
})
