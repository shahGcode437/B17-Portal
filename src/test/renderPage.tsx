import type { ReactElement } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { render } from "@testing-library/react"
import { vi } from "vitest"
import { AuthContext } from "@/hooks/useAuth"
import { ToastContext } from "@/hooks/useToast"
import { authContextValue, testUser } from "@/test/authFixtures"
import { LocationProbe } from "@/test/LocationProbe"
import type { CurrentUser } from "@/types/auth"

interface RenderPageOptions {
  /** The URL to start at. */
  url: string
  /** The route pattern the page is mounted on (defaults to matching everything). */
  path?: string
  /** `null` = signed out; omitted = a plain signed-in resident; or pass roles via `user`. */
  user?: CurrentUser | null
  /** Auth bootstrap still running. */
  status?: "loading"
}

/**
 * Renders a page the way the router does - inside a router, the auth context and the toast context -
 * for component tests that read through the fake backend (test helper only).
 */
export function renderPage(page: ReactElement, options: RenderPageOptions) {
  // Some pages read the live browser URL when they write search params (see SearchPage.updateParams), so
  // the jsdom location starts in step with the router's. (It is not kept in step afterwards: multi-step URL
  // flows are covered by the Playwright suite, which uses the real browser router.)
  window.history.replaceState({}, "", options.url)
  const show = vi.fn()
  const user = options.user === undefined ? testUser() : options.user
  const auth = authContextValue({ user, ...(options.status === "loading" ? { status: "loading" as const, isAuthenticated: false } : {}) })
  const utils = render(
    <MemoryRouter initialEntries={[options.url]}>
      <AuthContext.Provider value={auth}>
        <ToastContext.Provider value={{ show }}>
          <Routes>
            <Route path={options.path ?? "*"} element={page} />
            <Route path="*" element={<p>elsewhere</p>} />
          </Routes>
          <LocationProbe />
        </ToastContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
  return { ...utils, show, auth }
}
