import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useReferrerPolicy } from "@/hooks/useReferrerPolicy"
import { routes } from "@/config/routes"
import { verifyEmail } from "@/lib/api/auth"
import { isApiError } from "@/lib/api/errors"
import { clearFragmentToken, takeFragmentToken } from "@/lib/fragmentToken"
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
    <Container className="py-12 sm:py-20">
      <div className="mx-auto max-w-sm">
        <Stack gap={6} align="center" className="text-center">
          <Typography variant="h1">Verify your email</Typography>

          {outcome === "verifying" && (
            <div role="status" className="flex flex-col items-center gap-3">
              <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
              <Typography variant="body-sm" className="text-muted-foreground">
                Verifying your email address
              </Typography>
            </div>
          )}

          {outcome === "verified" && (
            <Stack gap={4} className="w-full">
              <div role="status" className="rounded-lg border border-border bg-muted px-4 py-3">
                <Typography variant="body-sm">Your email address is verified. Thank you.</Typography>
              </div>
              <Button asChild size="lg">
                <Link to={routes.home}>Continue</Link>
              </Button>
            </Stack>
          )}

          {outcome !== "verifying" && outcome !== "verified" && (
            <Stack gap={4} className="w-full">
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                <Typography variant="body-sm" className="text-destructive">
                  {outcome === "expired" && "This verification link has expired."}
                  {outcome === "invalid" && "This verification link is invalid or has already been used."}
                  {outcome === "missing" && "This verification link is incomplete."}
                  {outcome === "failed" && (detail ?? "We couldn't verify your email address.")}
                </Typography>
              </div>
              <Typography variant="body-sm" className="text-muted-foreground">
                Log in and use "Resend verification email" on your profile to get a new link.
              </Typography>
              <Button asChild size="lg" variant="outline">
                <Link to={routes.profile}>Go to my profile</Link>
              </Button>
            </Stack>
          )}
        </Stack>
      </div>
    </Container>
  )
}

export { VerifyEmailPage }
