import { useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"

/**
 * Whole-page auth gate for screens with no meaningful guest view (Provider
 * Dashboard, Create Listing, Pending). Redirects to Login preserving the
 * page to return to — same intent-preservation pattern as Request Service
 * (Phase 3B), just applied to an entire route instead of a single action.
 */
export function useRequireAuth() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!user) {
      navigate(routes.login, { state: { from: location.pathname }, replace: true })
    }
  }, [user, navigate, location.pathname])

  return user
}
