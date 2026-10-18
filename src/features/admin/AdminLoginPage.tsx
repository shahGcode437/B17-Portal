import { useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { motion } from "motion/react"
import { Loader2, ShieldCheck } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { safeLocalPath } from "@/lib/safePath"
import { fadeUp } from "@/lib/motion"
import { LoginForm } from "@/features/auth/AuthForms"
import { authErrorMessage } from "@/features/auth/authMessages"

interface AdminLoginLocationState {
  from?: string
}

/**
 * Admin Login (Phase 12C). There is ONE identity system: this is just another screen for the same
 * `POST /auth/login` as the customer Log In — no separate admin password, flag or storage. Whether
 * the signed-in account is an administrator comes only from the backend roles in `/auth/me`; an
 * ordinary account that signs in here is told so and offered a way to switch. (Admin screens'
 * session-freshness rules are enforced by the API, not by a frontend timer.)
 */
function AdminLoginPage() {
  const location = useLocation()
  const { status, user, logout } = useAuth()
  const state = (location.state ?? {}) as AdminLoginLocationState
  const from = safeLocalPath(state.from)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  if (status === "loading") {
    return (
      <div role="status" className="flex min-h-[50svh] flex-col items-center justify-center gap-3 px-4 py-16">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <Typography variant="body-sm" className="text-muted-foreground">
          Checking your session
        </Typography>
      </div>
    )
  }

  if (status === "authenticated" && user?.roles.includes("admin")) {
    return <Navigate to={from && from.startsWith("/admin") ? from : routes.adminDashboard} replace />
  }

  async function switchAccount() {
    setLogoutError(null)
    try {
      await logout()
    } catch (cause) {
      setLogoutError(authErrorMessage(cause))
    }
  }

  return (
    <Container className="py-16 sm:py-24">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack gap={6}>
          <Stack align="center" gap={4} className="text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={2}>
              <Typography variant="h1">Admin Login</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Log in with an administrator account to review and moderate listings.
              </Typography>
            </Stack>
          </Stack>

          {status === "authenticated" ? (
            <Stack gap={4} align="center" className="text-center">
              <div role="alert" className="rounded-lg border border-border bg-muted px-4 py-3">
                <Typography variant="body-sm">
                  You're signed in as {user?.displayName}, which isn't an administrator account.
                </Typography>
              </div>
              {logoutError && (
                <Typography variant="body-sm" className="text-destructive" role="alert">
                  {logoutError}
                </Typography>
              )}
              <Button type="button" size="lg" variant="outline" onClick={switchAccount}>
                Log out to switch account
              </Button>
            </Stack>
          ) : (
            <LoginForm />
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { AdminLoginPage }
