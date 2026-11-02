import { useState } from "react"
import { MailWarning } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { devVerifyCommand, isDevMail } from "@/config/devMail"
import { resendVerification } from "@/lib/api/auth"
import { authErrorMessage } from "@/features/auth/authMessages"
import { VERIFICATION_REASON, VERIFICATION_UNLOCKS } from "@/features/auth/verificationCopy"

/**
 * Non-blocking reminder for a signed-in account whose e-mail is not yet verified (Phase 12C).
 * Unverified accounts are valid: they may browse and use low-risk features, and are never logged
 * out. The backend refuses verified-only actions (writes, requests) with `403 email_not_verified`
 * whatever this notice shows. Resend is authenticated + CSRF (handled by the API client) and the
 * confirmation is neutral.
 */
function VerificationNotice() {
  const { user } = useAuth()
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  const [error, setError] = useState<string | null>(null)

  if (!user || user.emailVerified) return null
  const devMail = isDevMail()

  async function resend() {
    setState("sending")
    setError(null)
    try {
      await resendVerification()
      setState("sent")
    } catch (cause) {
      setState("idle")
      setError(authErrorMessage(cause))
    }
  }

  return (
    <section
      aria-label="Email verification"
      className="glass-panel rounded-2xl p-4 ring-1 ring-warning/35 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning-text">
          <MailWarning className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <Typography variant="body-sm" className="font-medium">
            Verify your email address
          </Typography>
          {devMail ? (
            // Development: nothing is e-mailed. Say what is true and how to get the link.
            <Typography variant="body-sm" className="text-muted-foreground" data-testid="dev-verification-hint">
              Development: no e-mail is sent. In <code>backend/</code> run{" "}
              <code className="break-all">{devVerifyCommand(user.email)}</code> to get your link, then open it (the same
              link is also printed in the API terminal). Verifying lets you {VERIFICATION_UNLOCKS}; browsing works either
              way.
            </Typography>
          ) : (
            // Production: production e-mail delivery does not exist yet, so this never says a message was sent.
            <Typography variant="body-sm" className="text-muted-foreground" data-testid="verification-reason">
              {user.email} is not verified yet. {VERIFICATION_REASON}
            </Typography>
          )}
          <div role="status" aria-live="polite">
            {state === "sent" && (
              <Typography variant="body-sm">
                {devMail
                  ? "A new link was issued. Nothing is e-mailed in development: run the command above, or read the API terminal."
                  : "A new verification link was requested."}
              </Typography>
            )}
            {error && (
              <Typography variant="body-sm" className="text-destructive">
                {error}
              </Typography>
            )}
          </div>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={resend} disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Resend verification email"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export { VerificationNotice }
