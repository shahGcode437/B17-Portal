import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { CircleCheck, Loader2 } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useReferrerPolicy } from "@/hooks/useReferrerPolicy"
import { routes } from "@/config/routes"
import { verifyEmail } from "@/lib/api/auth"
import { isApiError } from "@/lib/api/errors"
import { clearFragmentToken, takeFragmentToken } from "@/lib/fragmentToken"
import { AuthNotice, AuthShell } from "@/features/auth/AuthShell"
import { authErrorMessage } from "@/features/auth/authMessages"

type Outcome = "verifying" | "verified" | "missing" | "invalid" | "expired" | "failed"

/**
 * Verify e-mail (Phase 12C). The one-time token arrives in the URL FRAGMENT: it was moved into
 * memory and stripped from the address bar at app start (and again here, idempotently), is sent
 * exactly once, is never persisted or logged, and is dropped right after. The page sets
 * `Referrer-Policy: no-referrer`. On success `/auth/me` is re-read so `emailVerified` becomes true.
 */
function VerifyEmailPage() {
  useReferrerPolicy("no-referrer")
  const { refreshMe } = useAuth()
  const [token] = useState(() => takeFragmentToken(routes.verifyEmail))
  const [outcome, setOutcome] = useState<Outcome>(token ? "verifying" : "missing")
  const [detail, setDetail] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true // StrictMode runs effects twice: the token must be spent once
    void verifyEmail(token)
      .then(async () => {
        clearFragmentToken()
        await refreshMe({ fresh: true })
        setOutcome("verified")
      })
      .catch((cause: unknown) => {
        clearFragmentToken()
        if (isApiError(cause) && cause.code === "token_expired") setOutcome("expired")
        else if (isApiError(cause) && cause.code === "token_invalid") setOutcome("invalid")
        else {
          setOutcome("failed")
          setDetail(authErrorMessage(cause))
        }
      })
  }, [token, refreshMe])

  return (
    <AuthShell>
      <Stack gap={6}>
        <Typography variant="h1">Verify your email</Typography>

        {outcome === "verifying" && (
          <div role="status" className="flex items-center gap-3 rounded-xl bg-muted/70 px-4 py-4 ring-1 ring-border">
            <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <Typography variant="body-sm" className="text-muted-foreground">
              Verifying your email address
            </Typography>
          </div>
        )}

        {outcome === "verified" && (
          <Stack gap={4}>
            <div role="status" className="flex items-start gap-3 rounded-xl bg-success/10 px-4 py-4 ring-1 ring-success/30">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-text" aria-hidden="true" />
              <Typography variant="body-sm" className="font-medium">
                Your email address is verified. Thank you.
              </Typography>
            </div>
            <Button asChild size="lg" className="h-11 text-base font-semibold">
              <Link to={routes.home}>Continue</Link>
            </Button>
          </Stack>
        )}

        {outcome !== "verifying" && outcome !== "verified" && (
          <Stack gap={4}>
            <AuthNotice role="alert" tone="error">
              <Typography variant="body-sm" className="text-destructive">
                {outcome === "expired" && "This verification link has expired."}
                {outcome === "invalid" && "This verification link is invalid or has already been used."}
                {outcome === "missing" && "This verification link is incomplete."}
                {outcome === "failed" && (detail ?? "We couldn't verify your email address.")}
              </Typography>
            </AuthNotice>
            <Typography variant="body-sm" className="text-muted-foreground">
              Log in and use "Resend verification email" on your profile to get a new link.
            </Typography>
            <Button asChild size="lg" variant="outline" className="h-11 text-base font-semibold">
              <Link to={routes.profile}>Go to my profile</Link>
            </Button>
          </Stack>
        )}
      </Stack>
    </AuthShell>
  )
}

export { VerifyEmailPage }
