import { vi } from "vitest"
import type { AuthContextValue } from "@/hooks/useAuth"
import type { CurrentUser } from "@/types/auth"

/** A signed-in user as the UI sees it (test helper only). */
export function testUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    displayName: "Tester",
    email: "tester@example.org",
    emailVerified: true,
    roles: [],
    staffScopes: [],
    authMethods: { password: true, providers: [] },
    session: { expiresAt: "2030-01-01T00:00:00Z" },
    ...overrides,
  }
}

/** A complete AuthContext value for component tests that don't exercise the real provider. */
export function authContextValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user === undefined ? testUser() : overrides.user
  return {
    status: user ? "authenticated" : "anonymous",
    user,
    isAuthenticated: user !== null,
    notice: null,
    bootstrapError: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
    refreshMe: vi.fn(() => Promise.resolve(user !== null)),
    retryBootstrap: vi.fn(),
    dismissNotice: vi.fn(),
    ...overrides,
  }
}

/** A signed-in admin (= Super Admin): authority comes only from the backend roles on `/auth/me`. */
export function adminUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return testUser({ displayName: "Site Admin", roles: ["admin"], ...overrides })
}

/** A signed-in Moderator (RBAC-A: reportable by the backend, but no screen is Moderator-accessible yet). */
export function moderatorUser(
  staffScopes: CurrentUser["staffScopes"] = ["food"],
  overrides: Partial<CurrentUser> = {}
): CurrentUser {
  return testUser({ displayName: "Scoped Moderator", roles: ["moderator"], staffScopes, ...overrides })
}
