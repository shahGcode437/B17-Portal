import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { AdminLayout } from "@/app/AdminLayout"
import { AuthGate } from "@/components/access/AuthGate"
import { ToastProvider } from "@/components/feedback/ToastProvider"
import { AdminLoginPage } from "@/features/admin/AdminLoginPage"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { GrocerySettingsPage } from "@/features/grocery-staff/settings/GrocerySettingsPage"
import { StaffGroceryOrderPage } from "@/features/grocery-staff/StaffGroceryOrderPage"
import { StaffHistoryPage } from "@/features/staff-management/StaffHistoryPage"
import { StaffManagementPage } from "@/features/staff-management/StaffManagementPage"
import { fail, installFetchMock, meBody, ok, type MockCall, type MockReply } from "@/test/apiMock"
import { AdminBackend, MemoryDirectory, type DirectoryAccount } from "@/test/fixtures/adminBackend"
import type { StaffScope } from "@/types/auth"

/**
 * The Super Admin screens as the app mounts them (real auth provider, real gates, real layout) over
 * the fake backend. Test helper only: nothing here ships.
 */
export const account = (
  n: number,
  displayName: string,
  roles: string[] = [],
  scopes: StaffScope[] = [],
  extra: Partial<DirectoryAccount> = {}
): DirectoryAccount => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  email: `${displayName.toLowerCase().replace(/\s+/g, ".")}@example.org`,
  displayName,
  emailVerified: true,
  status: "active",
  roles,
  scopes,
  ...extra,
})

export function people(): DirectoryAccount[] {
  return [
    account(1, "Omar Superadmin", ["admin"]),
    account(2, "Zara Superadmin", ["admin"]),
    account(3, "Sana Grocer", ["moderator"], ["grocery"]),
    account(4, "Farah Food", ["moderator"], ["food"]),
    account(5, "Pia Paused", ["moderator"], []),
    account(6, "Rafi Resident"),
    account(7, "Uma Unverified", [], [], { emailVerified: false }),
    account(8, "Sami Suspended", [], [], { status: "suspended" }),
  ]
}

type Fault = "lost-before" | "lost-after" | "error-after"

export function fakeAdminServer(signedInAs: string | null = "Omar Superadmin") {
  const directory = new MemoryDirectory(people())
  const admin = new AdminBackend(directory)
  const byName = (name: string) => directory.accounts.find((a) => a.displayName === name)!
  const state = {
    session: signedInAs ? byName(signedInAs).id : (null as string | null),
    csrfSerial: 1,
    csrf: "csrf-1",
    /** The admin routes answer `401 session_expired` (the `/auth/me` session stays valid). */
    staffSessionStale: false,
    writeFaults: [] as Fault[],
    readsFail: null as null | "network" | "server",
    /** Admin reads are refused although `/auth/me` still reports the same authority. */
    readsRefused: false,
    writeGate: null as Promise<unknown> | null,
    /** Holds the NEXT admin read (only that one) until it resolves. */
    nextReadGate: null as Promise<unknown> | null,
    /** Runs just before the next admin read answers (for a change made "meanwhile"). */
    beforeNextRead: null as null | (() => void),
  }

  /** Another tab logs in (or out): the cookie now belongs to someone else. */
  function signInAs(name: string | null) {
    state.session = name ? byName(name).id : null
    state.csrf = `csrf-${++state.csrfSerial}`
  }

  const current = () => directory.accounts.find((a) => a.id === state.session) ?? null

  async function handle(call: MockCall): Promise<MockReply | "network-error"> {
    const who = current()
    if (call.path === "/auth/me") {
      return who
        ? ok(meBody({ id: who.id, displayName: who.displayName, email: who.email, roles: who.roles, staffScopes: who.scopes, csrfToken: state.csrf }))
        : fail(401, "unauthenticated")
    }
    if (call.path === "/auth/logout") {
      signInAs(null)
      return { status: 204 }
    }
    if (call.path === "/auth/login") {
      const found = directory.accounts.find((a) => a.email === (call.body as { email: string }).email)
      if (!found) return fail(401, "invalid_credentials")
      signInAs(found.displayName)
      admin.recentSignIn = true
      state.staffSessionStale = false
      return ok(meBody({ id: found.id, displayName: found.displayName, email: found.email, roles: found.roles, staffScopes: found.scopes, csrfToken: state.csrf }))
    }
    if (call.path.startsWith("/admin/")) {
      const write = call.method !== "GET"
      if (write && who && call.headers.get("X-CSRF-Token") !== state.csrf) return fail(403, "csrf_failed")
      if (who && state.staffSessionStale) return fail(401, "session_expired")
      if (!write) {
        const gate = state.nextReadGate
        if (gate) {
          state.nextReadGate = null
          await gate
        }
        const meanwhile = state.beforeNextRead
        state.beforeNextRead = null
        meanwhile?.()
        if (state.readsRefused) return fail(403, "forbidden")
        if (state.readsFail === "network") return "network-error"
        if (state.readsFail === "server") return fail(500, "internal_error")
      }
      if (write && state.writeGate) await state.writeGate
      const fault = write ? state.writeFaults.shift() : undefined
      if (fault === "lost-before") return "network-error"
      const answer = admin.route(
        call.method,
        call.path,
        new URL(call.url, "http://test.invalid").searchParams,
        call.body,
        who ? { id: who.id, displayName: who.displayName, superAdmin: who.roles.includes("admin"), emailVerified: who.emailVerified } : null
      )
      if (fault === "lost-after") return "network-error"
      if (fault === "error-after") return fail(500, "internal_error")
      return answer ?? fail(404, "not_found")
    }
    return fail(404, "not_found")
  }

  const { calls } = installFetchMock(handle)
  const adminCalls = () => calls.filter((call) => call.path.startsWith("/admin/"))
  const writes = () => adminCalls().filter((call) => call.method !== "GET")

  return { directory, admin, state, signInAs, byName, calls, adminCalls, writes }
}

export type FakeAdminServer = ReturnType<typeof fakeAdminServer>

export function renderAdminApp(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "login", element: <AdminLoginPage /> },
          {
            element: <AuthGate requires="admin" />,
            children: [
              { path: "grocery/settings", element: <GrocerySettingsPage /> },
              { path: "staff", element: <StaffManagementPage /> },
              { path: "staff/history", element: <StaffHistoryPage /> },
              { index: true, element: <h1>Dashboard stand-in</h1> },
            ],
          },
          {
            element: <AuthGate requires="grocery-staff" />,
            children: [
              { path: "grocery", element: <h1>Queue stand-in</h1> },
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

export const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name })

export const dialog = () => screen.findByRole("dialog")

export const inDialog = () => within(screen.getByRole("dialog"))
