import * as React from "react"
import { AuthContext, type DemoUser } from "@/hooks/useAuth"
import { useResidentStore } from "@/state/residentStore"

/**
 * Simulated authentication (Master Spec §19, §9 — no real backend,
 * password, or session). State lives only in memory for this demo and
 * resets on reload; nothing is persisted.
 */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<DemoUser | null>(null)

  const login = React.useCallback((name: string) => {
    setUser({ name: name.trim() })
  }, [])

  const logout = React.useCallback(() => {
    setUser(null)
    // Explicit Log Out is this demo's privacy boundary (Phase 9C) — the
    // resident store has no real per-account scoping, so an explicit
    // sign-out clears it rather than leaving one resident's saved items
    // and request history visible to the next person on this browser.
    useResidentStore.getState().clearResidentData()
  }, [])

  const value = React.useMemo(() => ({ user, login, logout }), [user, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
