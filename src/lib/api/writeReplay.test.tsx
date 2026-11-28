import { act, render, screen, waitFor } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it } from "vitest"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { useAuth, type AuthContextValue } from "@/hooks/useAuth"
import * as authApi from "@/lib/api/auth"
import { ApiError } from "@/lib/api/errors"
import { getCsrfToken } from "@/lib/api/session"
import * as adminWrites from "@/lib/api/writes/admin"
import * as groceryWrites from "@/lib/api/writes/grocery"
import * as settingsWrites from "@/lib/api/writes/grocerySettings"
import * as staffOrderWrites from "@/lib/api/writes/groceryStaff"
import * as listingWrites from "@/lib/api/writes/listings"
import * as professionalWrites from "@/lib/api/writes/professional"
import * as requestWrites from "@/lib/api/writes/requests"
import * as savedWrites from "@/lib/api/writes/saved"
import * as staffAdminWrites from "@/lib/api/writes/staffAdmin"
import { ALICE, BOB, sharedCookieServer } from "@/test/sharedCookieServer"

/**
 * SECURITY: no authenticated change is ever sent again by the app. A tab signed in as Alice presses
 * a button after another tab signed in as Bob: the server refuses Alice's stale CSRF token, and the
 * refusal must reach the screen. If the client fetched Bob's token and sent the request again, the
 * server would carry Alice's change out as Bob.
 *
 * Every authenticated write the app has is listed here; the last test fails when one is added
 * without being listed.
 */
const ID = "99999999-0000-4000-8000-000000000001"
const anyBody = {} as never

type Write = [module: string, name: string, call: () => Promise<unknown>]

const WRITES: Write[] = [
  ["auth", "logout", () => authApi.logout()],
  ["auth", "resendVerification", () => authApi.resendVerification()],
  ["admin", "approveListing", () => adminWrites.approveListing(ID, 1)],
  ["admin", "rejectListing", () => adminWrites.rejectListing(ID, 1, "A reason that is long enough")],
  ["admin", "createCategory", () => adminWrites.createCategory({ module: "services", name: "Alice's category" })],
  ["admin", "patchCategory", () => adminWrites.patchCategory(ID, { name: "Renamed by Alice" })],
  ["admin", "reorderCategories", () => adminWrites.reorderCategories({ module: "services", parentId: null, orderedIds: [ID] })],
  ["grocery", "submitGroceryOrder", () => groceryWrites.submitGroceryOrder(anyBody, "key-alice-0001")],
  ["grocery", "cancelGroceryOrder", () => groceryWrites.cancelGroceryOrder(ID, 1, "Alice changed her mind")],
  ["listings", "createListing", () => listingWrites.createListing(anyBody)],
  ["listings", "patchListing", () => listingWrites.patchListing(ID, { revision: 1, description: "Alice" })],
  ["listings", "archiveListing", () => listingWrites.archiveListing(ID, 1)],
  ["professional", "createProfessionalProfile", () => professionalWrites.createProfessionalProfile()],
  ["requests", "createRequest", () => requestWrites.createRequest(anyBody)],
  ["requests", "actOnRequest", () => requestWrites.actOnRequest(ID, "cancel")],
  ["saved", "saveListing", () => savedWrites.saveListing(ID)],
  ["saved", "unsaveListing", () => savedWrites.unsaveListing(ID)],
  ["groceryStaff", "claimGroceryOrder", () => staffOrderWrites.claimGroceryOrder(ID)],
  ["groceryStaff", "releaseGroceryOrder", () => staffOrderWrites.releaseGroceryOrder(ID)],
  ["groceryStaff", "confirmGroceryOrder", () => staffOrderWrites.confirmGroceryOrder(ID, anyBody)],
  ["groceryStaff", "reconfirmGroceryOrder", () => staffOrderWrites.reconfirmGroceryOrder(ID, anyBody)],
  ["groceryStaff", "reduceGroceryAmount", () => staffOrderWrites.reduceGroceryAmount(ID, anyBody)],
  ["groceryStaff", "startPreparingGroceryOrder", () => staffOrderWrites.startPreparingGroceryOrder(ID, anyBody)],
  ["groceryStaff", "dispatchGroceryOrder", () => staffOrderWrites.dispatchGroceryOrder(ID, anyBody)],
  ["groceryStaff", "recordFailedGroceryDelivery", () => staffOrderWrites.recordFailedGroceryDelivery(ID, anyBody)],
  ["groceryStaff", "completeGroceryOrder", () => staffOrderWrites.completeGroceryOrder(ID, anyBody)],
  ["groceryStaff", "cancelGroceryOrderAsStaff", () => staffOrderWrites.cancelGroceryOrderAsStaff(ID, anyBody)],
  ["groceryStaff", "recordGroceryIssue", () => staffOrderWrites.recordGroceryIssue(ID, anyBody)],
  ["grocerySettings", "updateGrocerySettings", () => settingsWrites.updateGrocerySettings({ revision: 1, enabled: true })],
  ["staffAdmin", "appointModerator", () => staffAdminWrites.appointModerator("someone@example.org", ["grocery"])],
  ["staffAdmin", "replaceModeratorScopes", () => staffAdminWrites.replaceModeratorScopes(ID, ["food"])],
  ["staffAdmin", "pauseModerator", () => staffAdminWrites.pauseModerator(ID)],
  ["staffAdmin", "resumeModerator", () => staffAdminWrites.resumeModerator(ID, ["food"])],
  ["staffAdmin", "removeModerator", () => staffAdminWrites.removeModerator(ID)],
]

/** The real auth layer (it gives the API client its session handlers), with a probe on its state. */
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
  await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent(`authenticated:${name}`))
  return { auth: () => latest.current!, who: () => screen.getByTestId("who").textContent }
}

describe("another account signs in before a change is sent", () => {
  it.each(WRITES)("%s.%s is sent once, never carried out as the other account", async (_module, _name, write) => {
    const server = sharedCookieServer(ALICE)
    const app = await signedInAs(ALICE.name)
    server.signInAs(BOB) // another tab

    const outcome = await act(async () => write().then(() => "resolved", (cause: unknown) => cause))

    expect(server.performed).toEqual([])
    expect(server.attempts()).toHaveLength(1)
    expect(server.attempts()[0].headers.get("X-CSRF-Token")).toBe("csrf-alice-1")
    expect(outcome).toBeInstanceOf(ApiError)
    expect((outcome as ApiError).code).toBe("csrf_failed")
    // The session is still re-read: the tab now knows who it is.
    await waitFor(() => expect(app.who()).toBe(`authenticated:${BOB.name}`))
    expect(getCsrfToken()).toBe("csrf-bob-2")
  })
})

describe("the same account's token went stale", () => {
  it.each(WRITES.filter(([, name]) => name !== "logout"))(
    "%s.%s is refused once, and works when the person sends it again",
    async (_module, _name, write) => {
      const server = sharedCookieServer(ALICE)
      await signedInAs(ALICE.name)
      server.rotateToken()

      await act(async () => expect(write()).rejects.toMatchObject({ code: "csrf_failed" }))
      expect(server.performed).toEqual([])
      expect(server.attempts()).toHaveLength(1)

      // Nothing happens by itself: only this second, explicit call sends it again.
      await act(async () => {
        await write().catch(() => undefined) // the fake's generic body may not suit every reader
      })
      expect(server.performed.map((p) => p.actor)).toEqual([ALICE.name])
      expect(server.attempts()).toHaveLength(2)
    }
  )

  it("logging out is refused once, keeps the person signed in, and works when pressed again", async () => {
    const server = sharedCookieServer(ALICE)
    const app = await signedInAs(ALICE.name)
    server.rotateToken()

    await act(async () => expect(app.auth().logout()).rejects.toMatchObject({ code: "csrf_failed" }))
    expect(app.who()).toBe(`authenticated:${ALICE.name}`)
    expect(server.state.account).toEqual(ALICE)

    await act(() => app.auth().logout())
    expect(server.state.account).toBeNull()
    expect(app.who()).toBe("anonymous:-")
  })

  it("logging out after another account signed in does not sign THEM out", async () => {
    const server = sharedCookieServer(ALICE)
    const app = await signedInAs(ALICE.name)
    server.signInAs(BOB)

    await act(async () => expect(app.auth().logout()).rejects.toMatchObject({ code: "csrf_failed" }))

    expect(server.state.account).toEqual(BOB)
    expect(app.who()).toBe(`authenticated:${BOB.name}`)
  })
})

describe("the list above is every authenticated write", () => {
  it("covers every function the write modules export", () => {
    const modules: [string, object][] = [
      ["admin", adminWrites],
      ["grocery", groceryWrites],
      ["grocerySettings", settingsWrites],
      ["groceryStaff", staffOrderWrites],
      ["listings", listingWrites],
      ["professional", professionalWrites],
      ["requests", requestWrites],
      ["saved", savedWrites],
      ["staffAdmin", staffAdminWrites],
    ]
    const files = Object.keys(import.meta.glob("/src/lib/api/writes/*.ts")).filter((path) => !path.endsWith(".test.ts"))
    expect(files.map((path) => path.split("/").pop()!.replace(".ts", "")).sort()).toEqual(modules.map(([name]) => name).sort())
    const exported = modules.flatMap(([module, functions]) =>
      Object.entries(functions)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => `${module}.${name}`)
    )
    const listed = WRITES.filter(([module]) => module !== "auth").map(([module, name]) => `${module}.${name}`)
    expect(listed.sort()).toEqual(exported.sort())
  })
})
