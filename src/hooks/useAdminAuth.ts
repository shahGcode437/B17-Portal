import { createContext, useContext } from "react"

/**
 * Deliberately minimal, and fully separate from the customer AuthContext
 * (Master Spec §19) — no real account, credentials, or session.
 */
export interface DemoAdmin {
  name: string
}

export interface AdminAuthContextValue {
  admin: DemoAdmin | null
  loginAsAdmin: () => void
  logout: () => void
}

export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

/** Simulated admin auth state — see AdminAuthProvider. No backend, no persistence. */
export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider")
  }
  return ctx
}
