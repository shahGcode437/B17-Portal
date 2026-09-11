import { createContext, useContext } from "react"

/** Deliberately minimal — no real account, credentials, or session (Master Spec §19). */
export interface DemoUser {
  name: string
}

export interface AuthContextValue {
  user: DemoUser | null
  login: (name: string) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Simulated auth state — see AuthProvider. No backend, no persistence. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
