import * as React from "react"
import { AuthContext, type DemoUser } from "@/hooks/useAuth"

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
  }, [])

  const value = React.useMemo(() => ({ user, login, logout }), [user, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
