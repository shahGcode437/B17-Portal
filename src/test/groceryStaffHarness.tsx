import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { AdminLayout } from "@/app/AdminLayout"
import { AuthGate } from "@/components/access/AuthGate"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { AdminLoginPage } from "@/features/admin/AdminLoginPage"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { StaffGroceryOrderPage } from "@/features/grocery-staff/StaffGroceryOrderPage"
import { StaffGroceryQueuePage } from "@/features/grocery-staff/StaffGroceryQueuePage"
import { fail, installFetchMock, meBody, ok, type MockCall, type MockReply } from "@/test/apiMock"
import { GroceryBackend } from "@/test/fixtures/groceryBackend"
import { GroceryStaffBackend, type StaffViewer } from "@/test/fixtures/groceryStaffBackend"

/**
 * The staff screens as the app mounts them (real auth provider, real gate, real layout) over the
 * fake Grocery backend. Test helper only: nothing here ships.
 */

export interface Account {
  id: string
  name: string
  roles: string[]
  staffScopes: string[]
}

const account = (n: number, name: string, roles: string[], staffScopes: string[] = []): Account => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  roles,
  staffScopes,
})

export const SANA = account(1, "Sana Moderator", ["moderator"], ["grocery"])
export const BILAL = account(2, "Bilal Moderator", ["moderator"], ["grocery"])
export const OWNER = account(3, "Omar Superadmin", ["admin"])
export const FOODIE = account(4, "Farah Food", ["moderator"], ["food"])
export const PAUSED = account(5, "Pia Paused", ["moderator"], [])
export const RESIDENT = account(6, "Rafi Resident", [])

export const CUSTOMER_KEY = "customer@example.org"

const viewerOf = (who: Account): StaffViewer => ({
  id: who.id,
  displayName: who.name,
  ownerKey: `${who.name}@staff`,
  superAdmin: who.roles.includes("admin"),
  groceryScope: who.roles.includes("moderator") && who.staffScopes.includes("grocery"),
  emailVerified: true,
})

type Fault = "lost-before" | "lost-after" | "error-after"

export function fakeStaffServer(signedIn: Account | null = SANA) {
  const store = new GroceryBackend()
  const staff = new GroceryStaffBackend(store)
  const state = {
    account: signedIn,
    csrfSerial: 1,
    /** The server's CSRF token for the current session. */
    csrf: "csrf-1",
    /** Staff routes answer `401 session_expired` (the `/auth/me` session stays valid). */
    staffSessionStale: false,
    writeFaults: [] as Fault[],
    /** Staff reads fail while set. */
    readsFail: null as null | "network" | "server",
    /** Holds the next staff write until it resolves. */
    writeGate: null as Promise<unknown> | null,
  }

  /** Another tab logs in (or out): the cookie now belongs to someone else. */
  function signInAs(next: Account | null) {
    state.account = next
    state.csrf = `csrf-${++state.csrfSerial}`
  }

  async function handle(call: MockCall): Promise<MockReply | "network-error"> {
    if (call.path === "/auth/me") {
      const who = state.account
      return who
        ? ok(meBody({ id: who.id, displayName: who.name, roles: who.roles, staffScopes: who.staffScopes, csrfToken: state.csrf }))
        : fail(401, "unauthenticated")
    }
    if (call.path === "/auth/logout") {
      signInAs(null)
      return { status: 204 }
    }
    if (call.path.startsWith("/admin/grocery/orders")) {
      const write = call.method !== "GET"
      if (write && state.account && call.headers.get("X-CSRF-Token") !== state.csrf) return fail(403, "csrf_failed")
      if (state.account && state.staffSessionStale) return fail(401, "session_expired")
      if (!write && state.readsFail === "network") return "network-error"
      if (!write && state.readsFail === "server") return fail(500, "internal_error")
      if (write && state.writeGate) await state.writeGate
      const fault = write ? state.writeFaults.shift() : undefined
      if (fault === "lost-before") return "network-error"
      const answer = staff.route(
        call.method,
        call.path,
        new URL(call.url, "http://test.invalid").searchParams,
        call.body,
        state.account ? viewerOf(state.account) : null
      )
      if (fault === "lost-after") return "network-error"
      if (fault === "error-after") return fail(500, "internal_error")
      return answer ?? fail(404, "not_found")
    }
    return fail(404, "not_found")
  }

  const { calls } = installFetchMock(handle)
  const staffCalls = () => calls.filter((call) => call.path.startsWith("/admin/grocery"))
  const writes = () => staffCalls().filter((call) => call.method !== "GET")

  return { store, staff, state, signInAs, calls, staffCalls, writes }
}

export type FakeStaffServer = ReturnType<typeof fakeStaffServer>

export function renderStaffApp(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "login", element: <AdminLoginPage /> },
          {
            element: <AuthGate requires="grocery-staff" />,
            children: [
              { path: "grocery", element: <StaffGroceryQueuePage /> },
              { path: "grocery/:orderId", element: <StaffGroceryOrderPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: [path] }
  )
  const user = userEvent.setup()
  render(
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  )
  return { user, router }
}

/** Another tab was used and this one is looked at again. */
export function returnToTab() {
  window.dispatchEvent(new Event("focus"))
}

export const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name })

export const dialog = () => screen.findByRole("dialog")

export const actions = () => screen.getByRole("region", { name: "Actions" })

export const actionButton = (name: string) => within(actions()).getByRole("button", { name })

export const queryAction = (name: string) => within(actions()).queryByRole("button", { name })
