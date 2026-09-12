import { useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useAdminAuth } from "@/hooks/useAdminAuth"
import { routes } from "@/config/routes"

/**
 * Whole-page auth gate for admin screens — mirrors useRequireAuth but
 * against the separate AdminAuthContext. Redirects to Admin Login,
 * preserving the page to return to.
 */
export function useRequireAdminAuth() {
  const { admin } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!admin) {
      navigate(routes.adminLogin, { state: { from: location.pathname }, replace: true })
    }
  }, [admin, navigate, location.pathname])

  return admin
}
