import * as React from "react"
import { AdminAuthContext, type DemoAdmin } from "@/hooks/useAdminAuth"

const DEMO_ADMIN: DemoAdmin = { name: "Demo Admin" }

/**
 * Simulated admin authentication (Master Spec §19, §9 — no real backend,
 * password, or session), kept entirely separate from the customer
 * AuthContext. State lives only in memory for this demo and resets on
 * reload; nothing is persisted.
 */
function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = React.useState<DemoAdmin | null>(null)

  const loginAsAdmin = React.useCallback(() => {
    setAdmin(DEMO_ADMIN)
  }, [])

  const logout = React.useCallback(() => {
    setAdmin(null)
  }, [])

  const value = React.useMemo(
    () => ({ admin, loginAsAdmin, logout }),
    [admin, loginAsAdmin, logout]
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export { AdminAuthProvider }
