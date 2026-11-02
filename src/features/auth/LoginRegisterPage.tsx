import { useEffect, useState } from "react"
import { Link, Navigate, useLocation } from "react-router-dom"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { routes, providerProfilePath } from "@/config/routes"
import { safeLocalPath } from "@/lib/safePath"
import { LoginForm, RegisterForm } from "@/features/auth/AuthForms"
import { AuthLoading, AuthNotice, AuthShell } from "@/features/auth/AuthShell"
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton"
import { oauthErrorMessage } from "@/features/auth/authMessages"

/** The Log In / Create Account switch is a segmented control: the active segment is a raised card on a tinted track. */
const MODE_TAB =
  "h-10 flex-1 rounded-lg text-sm font-medium text-muted-foreground transition-colors data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-subtle"

interface LoginLocationState {
  from?: string
  providerId?: string
}

/** The backend sends a failed Google sign-in back as `/login?error=<code>`; read it once, then it is stripped. */
function readOAuthError(): string | null {
  return new URLSearchParams(window.location.search).get("error")
}

function stripOAuthError(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has("error")) return
  url.searchParams.delete("error")
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Login / Register (Phase 12C: real accounts — email + password, or Google). The two modes share one
 * screen. Navigation after sign-in is decided at render time from the auth state, so the page never
 * redirects before `/auth/me` has answered, never flashes the form at an already-signed-in user, and
 * only ever goes to a validated local path (no open redirect).
 */
function LoginRegisterPage() {
  const location = useLocation()
  const { status, notice, bootstrapError, retryBootstrap, dismissNotice } = useAuth()
  const state = (location.state ?? {}) as LoginLocationState
  const from = safeLocalPath(state.from) ?? undefined

  const [mode, setMode] = useState<"login" | "register">(location.pathname === routes.register ? "register" : "login")
  const [oauthError] = useState(readOAuthError)
  const oauthMessage = oauthErrorMessage(oauthError)

  useEffect(() => {
    stripOAuthError()
  }, [])

  if (status === "loading") return <AuthLoading />

  if (status === "authenticated") {
    if (state.providerId) {
      return (
        <Navigate
          to={providerProfilePath(state.providerId)}
          replace
          state={{ openRequestFor: state.providerId }}
        />
      )
    }
    return <Navigate to={from ?? routes.home} replace />
  }

  return (
    <AuthShell>
      <Stack gap={6}>
        <Stack gap={2}>
          <Typography variant="h1">{mode === "login" ? "Log In" : "Create Account"}</Typography>
          <Typography variant="body" className="text-muted-foreground">
            {mode === "login"
              ? "Welcome back — log in to save listings and request services."
              : "Create an account to save listings and request services."}
          </Typography>
        </Stack>

        {notice && (
          <AuthNotice role="status">
            <Typography variant="body-sm">
              {notice === "disabled"
                ? "This account isn't available. If you think this is a mistake, please contact us."
                : "Your session has ended. Please log in again."}
            </Typography>
            <Button type="button" variant="link" size="sm" onClick={dismissNotice} className="-ml-2.5 h-auto">
              Dismiss
            </Button>
          </AuthNotice>
        )}

        {oauthMessage && (
          <AuthNotice role="alert" tone="error">
            <Typography variant="body-sm" className="text-destructive">
              {oauthMessage}
            </Typography>
          </AuthNotice>
        )}

        {status === "unavailable" && (
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

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as "login" | "register")
          }}
          aria-label="Choose login or register"
          className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1"
          spacing={1}
        >
          <ToggleGroupItem value="login" className={MODE_TAB}>
            Log In
          </ToggleGroupItem>
          <ToggleGroupItem value="register" className={MODE_TAB}>
            Create Account
          </ToggleGroupItem>
        </ToggleGroup>

        <GoogleSignInButton returnTo={from} />

        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <Typography as="span" variant="body-sm" className="text-muted-foreground">
            or use your email
          </Typography>
          <span className="h-px flex-1 bg-border" />
        </div>

        {mode === "login" ? <LoginForm /> : <RegisterForm />}

        <Typography variant="body-sm" className="text-center">
          <Link
            to={routes.home}
            className="inline-flex min-h-11 items-center rounded px-2 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to home
          </Link>
        </Typography>
      </Stack>
    </AuthShell>
  )
}

export { LoginRegisterPage }
