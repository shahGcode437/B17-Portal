/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AuthGate } from "@/components/access/AuthGate"
import { AuthContext } from "@/hooks/useAuth"
import { authContextValue, testUser } from "@/test/authFixtures"
import { usePlanStore } from "@/state/planStore"
import { useResidentStore } from "@/state/residentStore"
import type { ServiceRequestRecord } from "@/types/resident"

/**
 * Phase 12C audit: the two `localStorage`-persisted Zustand stores are DEMO product data, never an
 * authority for authentication, identity, Admin, the Professional capability, ownership or any
 * route decision. Those come only from `AuthProvider` + `/auth/me` (`user.roles`, `user.professional`).
 */

const SRC = resolve(process.cwd(), "src")
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const production = walk(SRC)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.includes(join("src", "test")))
  .map((file) => ({ file: relative(SRC, file).replaceAll("\\", "/"), code: readFileSync(file, "utf8") }))

const hostileRequest: ServiceRequestRecord = {
  id: "r1",
  providerId: "p1",
  providerName: "Admin",
  service: "x",
  details: "x",
  area: "B-17",
  preferredDate: "2030-01-01",
  requestedBy: "Root Admin",
  submittedAt: "2030-01-01T00:00:00Z",
  status: "submitted",
}

beforeEach(() => {
  // Everything an attacker (or a previous user) could plant in the persisted stores or beside them.
  window.localStorage.setItem(
    "b17-resident-store",
    JSON.stringify({ state: { savedItems: [], requests: [hostileRequest], roles: ["admin"], user: { id: "x", roles: ["admin"] }, professional: { planCode: "premium" } }, version: 0 })
  )
  window.localStorage.setItem("b17-plan-store", JSON.stringify({ state: { plan: "premium", roles: ["admin"], professional: { planCode: "premium" } }, version: 0 }))
  useResidentStore.setState({ savedItems: [], requests: [hostileRequest] })
  usePlanStore.setState({ plan: "premium" })
})

afterEach(() => {
  useResidentStore.setState({ savedItems: [], requests: [] })
  usePlanStore.setState({ plan: "free" })
})

function renderGate(requires: "authenticated" | "professional" | "admin", auth = authContextValue({ user: null })) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/area"]}>
        <Routes>
          <Route element={<AuthGate requires={requires} />}>
            <Route path="/area" element={<p>protected content</p>} />
          </Route>
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/admin/login" element={<p>admin login page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("persisted demo stores hold no security state", () => {
  it("persist exactly these fields, and nothing identity- or capability-shaped", () => {
    expect(Object.keys(useResidentStore.getState()).filter((key) => typeof useResidentStore.getState()[key as keyof ReturnType<typeof useResidentStore.getState>] !== "function").sort()).toEqual(["requests", "savedItems"])
    expect(Object.keys(usePlanStore.getState()).filter((key) => typeof usePlanStore.getState()[key as keyof ReturnType<typeof usePlanStore.getState>] !== "function")).toEqual(["plan"])
  })

  it("anonymous stays anonymous whatever the stores or localStorage claim", () => {
    renderGate("authenticated")
    expect(screen.getByText("login page")).toBeInTheDocument()
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("a premium plan and a planted 'admin' do not make an anonymous visitor an admin", () => {
    renderGate("admin")
    expect(screen.getByText("admin login page")).toBeInTheDocument()
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("a signed-in user WITHOUT the admin role is refused the admin area despite the planted stores", () => {
    renderGate("admin", authContextValue({ user: testUser({ roles: [] }) }))
    expect(screen.getByRole("heading", { level: 1, name: /admin access only/i })).toBeInTheDocument()
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("a premium local plan and a stored professional planCode do not grant the Professional workspace", () => {
    renderGate("professional", authContextValue({ user: testUser() })) // no `professional` from /auth/me
    expect(screen.getByRole("heading", { level: 1, name: /professional profile needed/i })).toBeInTheDocument()
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("the capabilities that DO come from /auth/me still open the gates (control)", () => {
    renderGate("admin", authContextValue({ user: testUser({ roles: ["admin"] }) }))
    expect(screen.getByText("protected content")).toBeInTheDocument()
  })

  it("no authentication, guard, header, layout or API module imports either persisted store", () => {
    const FORBIDDEN =
      /^(hooks\/(useAuth|useRequireAuth|useRequireAdminAuth)\.ts|components\/access\/AuthGate\.tsx|components\/navigation\/Header\.tsx|app\/.*\.tsx|lib\/.*\.ts|features\/admin\/AdminLoginPage\.tsx|features\/auth\/(?!AuthProvider).*)$/
    const importers = production.filter(({ code }) => /@\/state\/(residentStore|planStore)/.test(code)).map(({ file }) => file)

    expect(importers.filter((file) => FORBIDDEN.test(file))).toEqual([])
    // The ONLY auth-layer file that touches them is the provider, and only to WIPE them when a live
    // session ends (never to read identity out of them).
    const provider = production.find(({ file }) => file === "features/auth/AuthProvider.tsx")!.code
    expect(provider).toMatch(/clearResidentData\(\)/)
    expect(provider).toMatch(/resetPlan\(\)/)
    expect(provider).not.toMatch(/useResidentStore\(\s*\(|usePlanStore\(\s*\(|\.getState\(\)\.(savedItems|requests|plan)\b/)
  })

  it("plan entitlements (Free/Premium UX) are not consulted by any route guard", () => {
    const guards = production.filter(({ file }) => /AuthGate|useRequire|app\/router|AdminLayout|ProviderLayout/.test(file))
    for (const { code } of guards) expect(code).not.toMatch(/useCapability|RequireCapability|usePlanEntitlements|planStore/)
  })

  it("the persisted request snapshot's requestedBy is display text only (never compared to the signed-in identity)", () => {
    const uses = production.filter(({ code }) => /\.requestedBy|requestedBy:/.test(code))
    for (const { code } of uses) expect(code).not.toMatch(/requestedBy\s*(===|!==|==)|(===|!==)\s*[\w.]*requestedBy/)
  })
})
