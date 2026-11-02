import { useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { ShieldCheck } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { safeLocalPath } from "@/lib/safePath"
import { LoginForm } from "@/features/auth/AuthForms"
import { AuthLoading, AuthNotice, AuthShell } from "@/features/auth/AuthShell"
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
  const { status, user, logout, bootstrapError, retryBootstrap } = useAuth()
  const state = (location.state ?? {}) as AdminLoginLocationState
  const from = safeLocalPath(state.from)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  if (status === "loading") return <AuthLoading />

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
    <AuthShell brand={false}>
      <Stack gap={6}>
        <Stack gap={4}>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/25">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <Stack gap={2}>
            <Typography variant="h1">Admin Login</Typography>
            <Typography variant="body" className="text-muted-foreground">
              Log in with an administrator account to review and moderate listings.
            </Typography>
          </Stack>
        </Stack>

        {status === "unavailable" && (
          // Same honesty as the customer Log In: an unreachable server is not "logged out".
          <AuthNotice role="alert">
            <Typography variant="body-sm">
              {bootstrapError?.isNetwork ? "We couldn't reach the server." : "The server isn't responding properly."} You
              can still try to log in.
            </Typography>
            <Button type="button" variant="link" size="sm" onClick={retryBootstrap} className="-ml-2.5 h-auto">
              Check again
            </Button>
          </AuthNotice>
        )}

        {status === "authenticated" ? (
          <Stack gap={4}>
            <AuthNotice role="alert">
              <Typography variant="body-sm">
                You're signed in as {user?.displayName}, which isn't an administrator account.
              </Typography>
            </AuthNotice>
            {logoutError && (
              <Typography variant="body-sm" className="text-destructive" role="alert">
                {logoutError}
              </Typography>
            )}
            <Button type="button" size="lg" variant="outline" onClick={switchAccount} className="h-11 text-base font-semibold">
              Log out to switch account
            </Button>
          </Stack>
        ) : (
          <LoginForm />
        )}
      </Stack>
    </AuthShell>
  )
}

export { AdminLoginPage }
