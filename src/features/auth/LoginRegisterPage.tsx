import { useEffect, useState } from "react"
import { Link, Navigate, useLocation } from "react-router-dom"
import { motion } from "motion/react"
import { Loader2 } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { routes, providerProfilePath } from "@/config/routes"
import { safeLocalPath } from "@/lib/safePath"
import { fadeUp } from "@/lib/motion"
import { LoginForm, RegisterForm } from "@/features/auth/AuthForms"
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton"
import { oauthErrorMessage } from "@/features/auth/authMessages"

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
    <Container className="py-12 sm:py-20">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack gap={6}>
          <Stack gap={2} className="text-center">
            <Typography variant="h1">{mode === "login" ? "Log In" : "Create Account"}</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {mode === "login"
                ? "Welcome back — log in to save listings and request services."
                : "Create an account to save listings and request services."}
            </Typography>
          </Stack>

          {notice && (
            <div role="status" className="rounded-lg border border-border bg-muted px-3 py-2">
              <Typography variant="body-sm">
                {notice === "disabled"
                  ? "This account isn't available. If you think this is a mistake, please contact us."
                  : "Your session has ended. Please log in again."}
              </Typography>
              <Button type="button" variant="link" size="sm" onClick={dismissNotice}>
                Dismiss
              </Button>
            </div>
          )}

          {oauthMessage && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <Typography variant="body-sm" className="text-destructive">
                {oauthMessage}
              </Typography>
            </div>
          )}

          {status === "unavailable" && (
            <div role="alert" className="rounded-lg border border-border bg-muted px-3 py-2">
              <Typography variant="body-sm">
                {bootstrapError?.isNetwork ? "We couldn't reach the server." : "The server isn't responding properly."} You
                can still try to log in.
              </Typography>
              <Button type="button" variant="link" size="sm" onClick={retryBootstrap}>
                Check again
              </Button>
            </div>
          )}

          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(value) => {
              if (value) setMode(value as "login" | "register")
            }}
            aria-label="Choose login or register"
            className="w-full"
          >
            <ToggleGroupItem value="login" className="flex-1">
              Log In
            </ToggleGroupItem>
            <ToggleGroupItem value="register" className="flex-1">
              Create Account
            </ToggleGroupItem>
          </ToggleGroup>

          <GoogleSignInButton returnTo={from} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <Typography as="span" variant="caption">
              or use your email
            </Typography>
            <span className="h-px flex-1 bg-border" />
          </div>

          {mode === "login" ? <LoginForm /> : <RegisterForm />}

          <Typography variant="caption" className="text-center text-muted-foreground">
            <Link to={routes.home} className="underline underline-offset-4">
              Back to home
            </Link>
          </Typography>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { LoginRegisterPage }
