import { act, screen, waitFor, within } from "@testing-library/react"
import type { UserEvent } from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  account,
  dialog,
  fakeAdminServer,
  heading,
  inDialog,
  renderAdminApp,
  type FakeAdminServer,
} from "@/test/adminHarness"
import { deferred } from "@/test/apiMock"

const PRIVATE_EMAILS = ["sana.grocer@example.org", "farah.food@example.org", "pia.paused@example.org"]

const row = (name: string) => within(screen.getByRole("list", { name: "Staff" })).getByRole("button", { name: new RegExp(`^${name}`) })
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
const posts = (server: FakeAdminServer) => server.writes().map((c) => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/, ":id")}`)
const scope = (name: string) => inDialog().getByRole("checkbox", { name })
const confirm = (user: UserEvent, name: string) => user.click(inDialog().getByRole("button", { name }))

async function openStaff(server: FakeAdminServer = fakeAdminServer()) {
  const app = renderAdminApp("/admin/staff")
  await heading("Staff")
  await screen.findByRole("list", { name: "Staff" })
  return { server, ...app }
}

async function openMember(name: string, server: FakeAdminServer = fakeAdminServer()) {
  const app = await openStaff(server)
  await app.user.click(row(name))
  await screen.findByRole("heading", { level: 2, name })
  return app
}

const action = (name: string) =>
  within(screen.getByRole("group", { name: "Change this moderator" })).getByRole("button", { name })

async function startAppointment(user: UserEvent, email: string, scopes: string[]) {
  await user.click(screen.getByRole("button", { name: "Appoint moderator" }))
  await dialog()
  await user.type(inDialog().getByLabelText("Account email"), email)
  for (const name of scopes) await user.click(scope(name))
  await confirm(user, "Review")
}

async function appoint(user: UserEvent, email: string, scopes: string[] = ["Grocery orders"]) {
  await startAppointment(user, email, scopes)
  await user.click(inDialog().getByRole("checkbox", { name: /checked that this is the right/ }))
  await confirm(user, "Appoint moderator")
}

describe("who may manage staff", () => {
  it.each(["Sana Grocer", "Farah Food", "Pia Paused", "Rafi Resident"])("%s is refused, with no staff request", async (name) => {
    for (const path of ["/admin/staff", "/admin/staff/history"]) {
      const server = fakeAdminServer(name)
      const { router } = renderAdminApp(path)
      await heading("Admin access only")
      expect(server.adminCalls()).toEqual([])
      for (const email of PRIVATE_EMAILS.filter((e) => !e.startsWith(name.toLowerCase().split(" ")[0]))) {
        expect(document.body).not.toHaveTextContent(email)
      }
      router.dispose()
      document.body.innerHTML = ""
    }
  })

  it("a grocery Moderator's navigation has no Staff entry", async () => {
    fakeAdminServer("Sana Grocer")
    renderAdminApp("/admin/staff")
    await heading("Admin access only")
    expect(within(screen.getByRole("navigation", { name: "Admin" })).queryByRole("link", { name: "Staff" })).not.toBeInTheDocument()
  })

  it("signed out goes to the staff sign-in with the way back", async () => {
    const server = fakeAdminServer(null)
    const { router } = renderAdminApp("/admin/staff")
    await heading("Admin Login")
    expect(router.state.location.state).toEqual({ from: "/admin/staff" })
    expect(server.adminCalls()).toEqual([])
  })
})

describe("the staff list", () => {
  it("shows Super Admins first, each person's role, state and effective access", async () => {
    await openStaff()
    const rows = within(screen.getByRole("list", { name: "Staff" })).getAllByRole("button")
    expect(rows.map((r) => r.textContent?.split("@")[0].replace(/(\.\w+)?$/, ""))).toHaveLength(5)
    expect(rows[0]).toHaveTextContent(/Omar Superadmin.*Super Admin.*You.*Full staff access/)
    expect(rows[1]).toHaveTextContent(/Zara Superadmin/)
    expect(row("Farah Food")).toHaveTextContent("Moderator for: Food.")
    expect(row("Pia Paused")).toHaveTextContent(/Paused.*Paused: no staff access\./)
    expect(screen.getByRole("list", { name: "Staff" })).not.toHaveTextContent("Rafi Resident")
    expect(screen.getByText("Showing 1–5 of 5")).toBeInTheDocument()
  })

  it("shows an account that can't act even though it holds a scope", async () => {
    const server = fakeAdminServer()
    server.byName("Sana Grocer").status = "suspended"
    await openStaff(server)
    expect(row("Sana Grocer")).toHaveTextContent("Account suspended: no staff access.")
  })

  it("pages through a longer list", async () => {
    const server = fakeAdminServer()
    for (let n = 10; n < 40; n += 1) server.directory.accounts.push(account(n, `Mod ${n}`, ["moderator"], ["food"]))
    const { user } = await openStaff(server)
    expect(screen.getByText("Showing 1–20 of 35")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Showing 21–35 of 35")
    expect(server.adminCalls().at(-1)!.url).toContain("limit=20&offset=20")
  })

  it("a failed load is an error with a retry, and nothing can be appointed from nothing", async () => {
    const server = fakeAdminServer()
    server.state.readsFail = "network"
    const { user } = renderAdminApp("/admin/staff")
    await screen.findByText("Couldn't load the staff list")
    expect(screen.getByRole("button", { name: "Appoint moderator" })).toBeDisabled()
    server.state.readsFail = null
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByRole("list", { name: "Staff" })
  })
})

describe("keyboard focus", () => {
  it("follows to the person opened, back to the list, and to the list after a removal", async () => {
    const { user } = await openStaff()
    row("Farah Food").focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Farah Food" })).toHaveFocus())
    screen.getByRole("button", { name: "All staff" }).focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Staff list" })).toHaveFocus())

    await user.click(row("Farah Food"))
    await screen.findByRole("heading", { level: 2, name: "Farah Food" })
    await user.click(action("Remove moderator"))
    await dialog()
    await user.click(inDialog().getByRole("checkbox", { name: /Yes, remove/ }))
    await confirm(user, "Remove moderator")
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Staff list" })).toHaveFocus())
  })

  it("moves to the newly appointed moderator", async () => {
    const { user } = await openStaff()
    await appoint(user, "rafi.resident@example.org")
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Rafi Resident" })).toHaveFocus())
  })
})

describe("a Super Admin account", () => {
  it("can be looked at but not changed", async () => {
    const { server } = await openMember("Zara Superadmin")
    expect(screen.queryByRole("group", { name: "Change this moderator" })).not.toBeInTheDocument()
    expect(screen.getByText(/Super Admins can't be changed here/)).toBeInTheDocument()
    expect(server.writes()).toEqual([])
  })

  it("typing their address to appoint them is refused by the server and explained", async () => {
    const { user, server } = await openStaff()
    await appoint(user, "zara.superadmin@example.org")
    await inDialog().findByText(/A Super Admin can't be changed here/)
    expect(server.byName("Zara Superadmin").roles).toEqual(["admin"])
  })

  it("no screen offers making or unmaking a Super Admin", async () => {
    const { user } = await openStaff()
    await user.click(screen.getByRole("button", { name: "Appoint moderator" }))
    await dialog()
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/make .*super admin|promote|demote/i)
    expect(inDialog().queryByRole("checkbox", { name: /admin/i })).not.toBeInTheDocument()
  })
})

describe("appointing a moderator", () => {
  it("chooses no scope in advance and offers no account search", async () => {
    const { user, server } = await openStaff()
    await user.click(screen.getByRole("button", { name: "Appoint moderator" }))
    await dialog()
    expect(inDialog().getAllByRole("checkbox")).toHaveLength(6)
    for (const box of inDialog().getAllByRole("checkbox")) expect(box).not.toBeChecked()
    expect(inDialog().queryByRole("checkbox", { name: /news/i })).not.toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent("There is no account search")
    expect(inDialog().getByLabelText("Account email")).toHaveAttribute("autocomplete", "off")
    await confirm(user, "Review")
    expect(screen.getByRole("dialog")).toHaveTextContent("Enter the account's email address.")
    expect(screen.getByRole("dialog")).toHaveTextContent("Choose at least one scope.")
    expect(server.writes()).toEqual([])
  })

  it("reviews the account and the exact change, then needs the address confirmed", async () => {
    const { user, server } = await openStaff()
    await startAppointment(user, "  Rafi.Resident@example.org ", ["Grocery orders"])
    expect(screen.getByRole("dialog")).toHaveTextContent("Rafi.Resident@example.org")
    expect(screen.getByRole("dialog")).toHaveTextContent("Moderator for: Grocery orders")
    expect(screen.getByRole("dialog")).toHaveTextContent("All of their sessions end")
    await confirm(user, "Appoint moderator")
    expect(screen.getByRole("dialog")).toHaveTextContent("Check the address, then tick this.")
    expect(server.writes()).toEqual([])
    await user.click(inDialog().getByRole("checkbox", { name: /checked that this is the right/ }))
    await user.dblClick(inDialog().getByRole("button", { name: "Appoint moderator" }))
    await closed()

    expect(server.writes()).toHaveLength(1)
    expect(server.writes()[0]).toMatchObject({
      method: "POST",
      path: "/admin/staff/moderators",
      body: { email: "Rafi.Resident@example.org", scopes: ["grocery"] },
    })
    expect(server.byName("Rafi Resident")).toMatchObject({ roles: ["moderator"], scopes: ["grocery"] })
    // The new moderator's own record is shown, read from the server, with its history.
    await screen.findByRole("heading", { level: 2, name: "Rafi Resident" })
    expect(screen.getByText("Moderator for: Grocery orders.")).toBeInTheDocument()
    const history = await screen.findByRole("list", { name: "Changes to this account" })
    expect(history).toHaveTextContent(/Moderator appointed.*By Omar Superadmin/)
  })

  it("going back to the details keeps them and requires the check again", async () => {
    const { user } = await openStaff()
    await startAppointment(user, "rafi.resident@example.org", ["Food"])
    await user.click(inDialog().getByRole("checkbox", { name: /checked that/ }))
    await user.click(inDialog().getByRole("button", { name: "Change the details" }))
    expect(inDialog().getByLabelText("Account email")).toHaveValue("rafi.resident@example.org")
    expect(scope("Food")).toBeChecked()
    await confirm(user, "Review")
    expect(inDialog().getByRole("checkbox", { name: /checked that/ })).not.toBeChecked()
  })

  it("grocery is its own choice: other scopes never add it", async () => {
    const { user, server } = await openStaff()
    await appoint(user, "rafi.resident@example.org", ["Service providers", "Business directory", "Food", "Education", "Property"])
    await closed()
    expect((server.writes()[0].body as { scopes: string[] }).scopes).toEqual(["services", "directory", "food", "education", "property"])
    expect(server.byName("Rafi Resident").scopes).not.toContain("grocery")
  })

  it.each(["nobody@example.org", "uma.unverified@example.org", "sami.suspended@example.org"])(
    "%s: one answer for unknown and ineligible, nothing changed, the form kept",
    async (email) => {
      const { user, server } = await openStaff()
      await appoint(user, email)
      await inDialog().findByText(/That account can't be made a moderator/)
      expect(screen.getByRole("dialog")).toHaveTextContent("The server doesn't say which of these it was.")
      expect(screen.getByRole("dialog")).not.toHaveTextContent("server text")
      expect(server.admin.audit).toEqual([])
    }
  )

  it("an existing moderator is reported as such", async () => {
    const { user } = await openStaff()
    await appoint(user, "farah.food@example.org")
    await inDialog().findByText(/That account is already a moderator/)
  })

  it("too many changes: said plainly, nothing resent", async () => {
    const { user, server } = await openStaff()
    server.admin.staffRateLimited = true
    await appoint(user, "rafi.resident@example.org")
    await inDialog().findByText(/Too many staff changes/)
    expect(server.writes()).toHaveLength(1)
  })
})

describe("changing a moderator's scopes", () => {
  it("starts from what they have, shows the difference, and replaces the whole set", async () => {
    const { user, server } = await openMember("Farah Food")
    await user.click(action("Change scopes"))
    const form = await dialog()
    expect(form).toHaveTextContent("farah.food@example.org")
    expect(scope("Food")).toBeChecked()
    expect(scope("Grocery orders")).not.toBeChecked()
    expect(inDialog().getByRole("button", { name: "Save scopes" })).toBeDisabled()
    expect(form).toHaveTextContent("No change yet")
    await user.click(scope("Grocery orders"))
    expect(form).toHaveTextContent("Adds: Grocery orders")
    await user.click(scope("Food"))
    expect(form).toHaveTextContent("Removes: Food")
    await user.click(scope("Grocery orders"))
    expect(form).toHaveTextContent("To remove every scope, pause instead.")
    expect(inDialog().getByRole("button", { name: "Save scopes" })).toBeDisabled()
    await user.click(scope("Grocery orders"))
    await confirm(user, "Save scopes")
    await closed()
    expect(posts(server)).toEqual(["PUT /admin/staff/moderators/:id/scopes"])
    expect(server.writes()[0].body).toEqual({ scopes: ["grocery"] })
    await waitFor(() => expect(screen.getByText("Moderator for: Grocery orders.")).toBeInTheDocument())
    const history = screen.getByRole("list", { name: "Changes to this account" })
    await waitFor(() => expect(history).toHaveTextContent("Scopes taken away"))
    expect(history).toHaveTextContent("Before: Moderator, scopes: Food")
    expect(history).toHaveTextContent("After: Moderator, scopes: Grocery orders")
  })

  it("taking away grocery says their claimed orders stay and how to free them", async () => {
    const { user } = await openMember("Sana Grocer")
    await user.click(action("Change scopes"))
    await dialog()
    expect(screen.getByRole("dialog")).not.toHaveTextContent("stay assigned to them")
    await user.click(scope("Grocery orders"))
    await user.click(scope("Food"))
    expect(screen.getByRole("dialog")).toHaveTextContent("Grocery orders they have claimed stay assigned to them")
    expect(screen.getByRole("link", { hidden: true, name: "Grocery orders assigned to this person" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/admin\/grocery\?status=all&by=/)
    )
  })

  it("is not sent when someone else changed their access since it was opened", async () => {
    const { user, server } = await openMember("Farah Food")
    await user.click(action("Change scopes"))
    await dialog()
    await user.click(scope("Education"))
    // Another Super Admin gives them grocery meanwhile: replacing the set would silently take it away.
    server.byName("Farah Food").scopes = ["food", "grocery"]
    await confirm(user, "Save scopes")
    await closed()
    expect(await screen.findByText(/This person's access changed since you opened it/)).toBeInTheDocument()
    expect(server.writes()).toEqual([])
    expect(server.byName("Farah Food").scopes).toEqual(["food", "grocery"])
    await waitFor(() => expect(screen.getByText("Moderator for: Food, Grocery orders.")).toBeInTheDocument())
  })

  it("a dialog left open while their access changes cannot send", async () => {
    const { server, user } = await openMember("Farah Food")
    await user.click(action("Change scopes"))
    await dialog()
    await user.click(scope("Education"))
    server.byName("Farah Food").scopes = ["food", "grocery"]
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000)
    const reads = server.adminCalls().length
    act(() => void window.dispatchEvent(new Event("focus")))
    await inDialog().findByText(/This person's access changed while this was open/)
    expect(server.adminCalls().length).toBeGreaterThan(reads)
    expect(inDialog().getByRole("button", { name: "Save scopes" })).toBeDisabled()
    const after = server.adminCalls().length
    await user.keyboard("{Enter}")
    expect(server.adminCalls()).toHaveLength(after) // not even the check before sending
    expect(server.writes()).toEqual([])
  })

  it("is not sent if the account changes while the check before it is still waiting", async () => {
    const { user, server } = await openMember("Farah Food")
    await user.click(action("Pause"))
    await dialog()
    const check = deferred<void>()
    server.state.nextReadGate = check.promise // the re-read of Farah, sent as Omar
    await confirm(user, "Pause moderator")
    await waitFor(() => expect(server.state.nextReadGate).toBeNull())

    // Another tab signs in a different Super Admin, and this tab notices (as on returning to it).
    server.signInAs("Zara Superadmin")
    act(() => void window.dispatchEvent(new Event("focus")))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await screen.findByRole("list", { name: "Staff" })
    await act(async () => check.resolve())
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    // Zara's token is in place by now: without a check of WHO is asking, Omar's pause would go out as Zara.
    expect(server.writes()).toEqual([])
    expect(server.byName("Farah Food").scopes).toEqual(["food"])
  })

  it("a failed check before sending says nothing was sent", async () => {
    const { user, server } = await openMember("Farah Food")
    await user.click(action("Change scopes"))
    await dialog()
    await user.click(scope("Education"))
    server.state.readsFail = "network"
    await confirm(user, "Save scopes")
    await inDialog().findByText(/Couldn't check this person's current access — Nothing was sent/)
    expect(server.writes()).toEqual([])
    server.state.readsFail = null
    await confirm(user, "Save scopes")
    await closed()
    expect(server.writes()).toHaveLength(1)
  })
})

describe("pause, resume and remove", () => {
  it("pausing keeps the role and removes every scope, only after confirming", async () => {
    const { user, server } = await openMember("Sana Grocer")
    await user.click(action("Pause"))
    const form = await dialog()
    expect(form).toHaveTextContent("keep the moderator role but lose every scope")
    expect(form).toHaveTextContent("stay assigned to them")
    await confirm(user, "Back")
    await closed()
    expect(server.writes()).toEqual([])
    await user.click(action("Pause"))
    await dialog()
    await confirm(user, "Pause moderator")
    await closed()
    expect(posts(server)).toEqual(["POST /admin/staff/moderators/:id/pause"])
    expect(server.writes()[0].body).toBeUndefined()
    await waitFor(() => expect(screen.getByText("Paused: no staff access.")).toBeInTheDocument())
    expect(action("Resume")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Change scopes" })).not.toBeInTheDocument()
  })

  it("resuming starts with no scope chosen and needs at least one", async () => {
    const { user, server } = await openMember("Pia Paused")
    await user.click(action("Resume"))
    await dialog()
    for (const box of inDialog().getAllByRole("checkbox")) expect(box).not.toBeChecked()
    expect(inDialog().getByRole("button", { name: "Resume" })).toBeDisabled()
    await user.click(scope("Food"))
    await confirm(user, "Resume")
    await closed()
    expect(server.writes()[0].body).toEqual({ scopes: ["food"] })
    await waitFor(() => expect(screen.getByText("Moderator for: Food.")).toBeInTheDocument())
    expect(await screen.findByRole("list", { name: "Changes to this account" })).toHaveTextContent("Moderator resumed")
  })

  it("an ineligible paused account can't be resumed", async () => {
    const server = fakeAdminServer()
    server.byName("Pia Paused").status = "suspended"
    const { user } = await openMember("Pia Paused", server)
    await user.click(action("Resume"))
    await dialog()
    await user.click(scope("Food"))
    await confirm(user, "Resume")
    await inDialog().findByText(/That account can't be made a moderator/)
    expect(server.byName("Pia Paused").scopes).toEqual([])
  })

  it("removing needs an explicit tick and leaves the account itself", async () => {
    const { user, server } = await openMember("Farah Food")
    await user.click(action("Remove moderator"))
    const form = await dialog()
    expect(form).toHaveTextContent("Their account is not deleted.")
    await confirm(user, "Remove moderator")
    expect(form).toHaveTextContent("Confirm the removal.")
    expect(server.writes()).toEqual([])
    await user.click(inDialog().getByRole("checkbox", { name: "Yes, remove Farah Food as a moderator." }))
    await confirm(user, "Remove moderator")
    await closed()
    expect(posts(server)).toEqual(["DELETE /admin/staff/moderators/:id"])
    await screen.findByRole("list", { name: "Staff" })
    await waitFor(() => expect(screen.getByRole("list", { name: "Staff" })).not.toHaveTextContent("Farah Food"))
    expect(server.byName("Farah Food")).toMatchObject({ roles: [], status: "active" })
  })

  it("shows nothing changed until the server answers", async () => {
    const { user, server } = await openMember("Sana Grocer")
    const gate = deferred<void>()
    server.state.writeGate = gate.promise
    await user.click(action("Pause"))
    await dialog()
    await confirm(user, "Pause moderator")
    await waitFor(() => expect(inDialog().getByRole("button", { name: "Pausing…" })).toBeDisabled())
    expect(screen.getByText("Moderator for: Grocery orders.")).toBeInTheDocument()
    expect(screen.queryByText("Staff access saved.")).not.toBeInTheDocument()
    await act(async () => gate.resolve())
    await closed()
    expect(server.writes()).toHaveLength(1)
  })
})

describe("a sign-in that is too old for staff changes", () => {
  async function refused() {
    const { user, server, router } = await openMember("Sana Grocer")
    server.admin.recentSignIn = false
    await user.click(action("Pause"))
    await dialog()
    await confirm(user, "Pause moderator")
    await inDialog().findByText("Sign in again to manage staff")
    return { user, server, router }
  }

  it("is told apart from a lost session: still signed in, nothing changed, nothing more can be sent", async () => {
    const { server, router } = await refused()
    expect(router.state.location.pathname).toBe("/admin/staff")
    expect(screen.getByRole("dialog")).toHaveTextContent("Nothing was changed.")
    expect(inDialog().getByRole("button", { name: "Pause moderator" })).toBeDisabled()
    expect(server.writes()).toHaveLength(1)
    expect(server.byName("Sana Grocer").scopes).toEqual(["grocery"])
  })

  it("signs out, comes back after sign-in, sends NOTHING by itself, and reads the records again", async () => {
    const { user, server, router } = await refused()
    await confirm(user, "Sign out and sign in again")
    await heading("Admin Login")
    expect(router.state.location.state).toEqual({ from: "/admin/staff" })
    expect(screen.getByText(/You'll come back to Staff after signing in. No change is sent by itself/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in with Google instead" })).toHaveAttribute("href", "/login")
    expect(document.body).not.toHaveTextContent("sana.grocer@example.org")

    const reads = server.adminCalls().length
    await user.type(screen.getByLabelText("Email"), "omar.superadmin@example.org")
    await user.type(screen.getByLabelText("Password"), "correct horse battery")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))
    await heading("Staff")
    await screen.findByRole("list", { name: "Staff" })
    expect(router.state.location.pathname).toBe("/admin/staff")
    expect(server.adminCalls().length).toBeGreaterThan(reads)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(server.writes()).toHaveLength(1) // only the refused one
    expect(server.byName("Sana Grocer").scopes).toEqual(["grocery"])
    const stored = JSON.stringify([{ ...localStorage }, { ...sessionStorage }])
    expect(stored).not.toContain("correct horse")
    expect(stored).not.toContain("example.org")
  })

  it("a different Super Admin signing in afterwards inherits nothing", async () => {
    const { user, server } = await refused()
    await confirm(user, "Sign out and sign in again")
    await heading("Admin Login")
    await user.type(screen.getByLabelText("Email"), "zara.superadmin@example.org")
    await user.type(screen.getByLabelText("Password"), "correct horse battery")
    await user.click(screen.getByRole("button", { name: /^log in$/i }))
    await heading("Staff")
    await screen.findByRole("list", { name: "Staff" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 2, name: "Sana Grocer" })).not.toBeInTheDocument()
    expect(server.writes()).toHaveLength(1)
  })

  it("can be done before starting, from the page", async () => {
    const { user, server } = await openStaff()
    expect(screen.getByText(/Changing staff needs a recent sign-in/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Sign in again" }))
    await heading("Admin Login")
    expect(server.writes()).toEqual([])
  })

  it("looking at staff needs no recent sign-in", async () => {
    const server = fakeAdminServer()
    server.admin.recentSignIn = false
    await openMember("Sana Grocer", server)
    expect(await screen.findByText("The staff audit has no entry about this account.")).toBeInTheDocument()
  })
})

describe("losing the session, the role or the account", () => {
  const openForm = async () => {
    const app = await openMember("Sana Grocer")
    await app.user.click(action("Pause"))
    await dialog()
    return app
  }
  const nothingPrivate = () => {
    for (const email of PRIVATE_EMAILS) expect(document.body).not.toHaveTextContent(email)
  }

  it("an expired session on a change closes everything", async () => {
    const { user, server } = await openForm()
    server.state.staffSessionStale = true
    await confirm(user, "Pause moderator")
    await heading("Admin Login")
    nothingPrivate()
    expect(server.byName("Sana Grocer").scopes).toEqual(["grocery"])
  })

  it("an expired session on a refresh closes the list", async () => {
    const { user, server } = await openStaff()
    server.state.staffSessionStale = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await heading("Admin Login")
    nothingPrivate()
  })

  it("a removed Super Admin role on return to the tab closes the screen before any staff read", async () => {
    const { server } = await openForm()
    server.byName("Omar Superadmin").roles = []
    const before = server.adminCalls().length
    act(() => void window.dispatchEvent(new Event("focus")))
    await heading("Admin access only")
    nothingPrivate()
    expect(server.adminCalls()).toHaveLength(before)
  })

  it("a refused read drops what was on screen, even while the account still looks the same", async () => {
    const { user, server } = await openMember("Sana Grocer")
    await screen.findByText("The staff audit has no entry about this account.")
    server.state.readsRefused = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("Couldn't load the staff list")
    nothingPrivate()
    expect(screen.queryByRole("heading", { level: 2, name: "Sana Grocer" })).not.toBeInTheDocument()
  })

  it("a change pressed after another tab switched accounts is never replayed as that account", async () => {
    const { user, server } = await openForm()
    server.signInAs("Zara Superadmin")
    await confirm(user, "Pause moderator")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await screen.findByRole("list", { name: "Staff" })
    expect(server.writes()).toHaveLength(1)
    expect(server.writes()[0].headers.get("X-CSRF-Token")).toBe("csrf-1")
    expect(server.byName("Sana Grocer").scopes).toEqual(["grocery"])
    expect(screen.queryByRole("heading", { level: 2, name: "Sana Grocer" })).not.toBeInTheDocument()
  })

  it("switching to a moderator's account removes every staff record from the screen", async () => {
    const { server } = await openForm()
    server.signInAs("Sana Grocer")
    act(() => void window.dispatchEvent(new Event("focus")))
    await heading("Admin access only")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("farah.food@example.org")
  })
})

describe("an unclear answer to a staff change", () => {
  async function pauseUnclear(fault: "lost-before" | "lost-after" | "error-after", readsFailAfter = false) {
    const { user, server } = await openMember("Sana Grocer")
    await user.click(action("Pause"))
    await dialog()
    server.state.writeFaults.push(fault)
    if (readsFailAfter) {
      const gate = deferred<void>()
      server.state.writeGate = gate.promise
      await confirm(user, "Pause moderator")
      // The check before sending has passed; now the reload after the lost answer fails.
      await waitFor(() => expect(server.writes()).toHaveLength(1))
      server.state.readsFail = "network"
      await act(async () => gate.resolve())
    } else {
      await confirm(user, "Pause moderator")
    }
    await closed()
    return { user, server }
  }

  it("is never resent; no change is offered until the records are loaded again", async () => {
    const { user, server } = await pauseUnclear("lost-before", true)
    await screen.findByText(/We don't know whether the pause was saved/)
    expect(action("Pause")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Appoint moderator" })).toBeDisabled()
    expect(screen.queryByText("Staff access saved.")).not.toBeInTheDocument()
    server.state.readsFail = null
    await user.click(await screen.findByRole("button", { name: "Load staff records again" }))
    await screen.findByText(/Check whether the pause was saved/)
    expect(action("Pause")).toBeEnabled()
    expect(server.writes()).toHaveLength(1)
  })

  it.each(["lost-after", "error-after"] as const)("%s: the reload shows what the server holds", async (fault) => {
    const { server } = await pauseUnclear(fault)
    await screen.findByText(/Check whether the pause was saved/)
    await waitFor(() => expect(screen.getByText("Paused: no staff access.")).toBeInTheDocument())
    expect(server.writes()).toHaveLength(1)
  })
})

describe("the staff history", () => {
  async function openHistory() {
    const app = renderAdminApp("/admin/staff/history")
    await heading("Staff history")
    return app
  }

  it("shows the server's records, with command-line actions and their reasons", async () => {
    const server = fakeAdminServer()
    server.admin.record({
      source: "cli",
      action: "super_admin_promoted",
      target: { userId: server.byName("Zara Superadmin").id, displayName: "Zara Superadmin" },
      before: { role: null, scopes: [] },
      after: { role: "admin", scopes: [], sessions_revoked: 2 },
      reason: "Second administrator for cover",
      requestId: "req-internal-123",
    })
    server.admin.record({ source: "web", action: "taxonomy_updated", actor: { userId: "x" }, resourceType: "category", resourceId: "c-1", after: { revision: 2 } })
    await openHistory()
    const list = await screen.findByRole("list", { name: "Staff history" })
    expect(list).toHaveTextContent("Super Admin promoted")
    expect(list).toHaveTextContent("By Server operator (command line)")
    expect(list).toHaveTextContent("After: Super Admin")
    expect(list).toHaveTextContent("2 sessions ended.")
    expect(list).toHaveTextContent("Reason: Second administrator for cover")
    expect(list).toHaveTextContent("By An account whose name is no longer available")
    expect(list).not.toHaveTextContent("req-internal-123")
    expect(list).not.toHaveTextContent("c-1")
    expect(screen.getByText(/Grocery settings and order changes are not part of it/)).toBeInTheDocument()
    expect(server.writes()).toEqual([])
  })

  it("filters by the kind of action on the server, and pages", async () => {
    const server = fakeAdminServer()
    for (let n = 0; n < 25; n += 1) server.admin.record({ source: "cli", action: n % 5 === 0 ? "moderator_paused" : "provider_created" })
    const { user } = await openHistory()
    await screen.findByText("Showing 1–20 of 25")
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Showing 21–25 of 25")
    await user.selectOptions(screen.getByLabelText("Kind of action"), "moderator_paused")
    await screen.findByText("Showing 1–5 of 5")
    expect(server.adminCalls().at(-1)!.url).toContain("action=moderator_paused")
  })

  it("a refused read drops the history already shown", async () => {
    const server = fakeAdminServer()
    server.admin.record({ source: "web", action: "moderator_paused", target: { userId: "x", displayName: "Private Person" } })
    const { user } = await openHistory()
    await screen.findByText(/Private Person/)
    server.state.readsRefused = true
    await user.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("Couldn't load the staff history")
    expect(document.body).not.toHaveTextContent("Private Person")
  })

  it("says plainly when there is nothing", async () => {
    fakeAdminServer()
    await openHistory()
    await screen.findByText("The staff audit has no entry yet.")
  })
})
