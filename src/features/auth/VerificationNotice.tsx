import { useState } from "react"
import { MailWarning } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { devVerifyCommand, mailMode } from "@/config/devMail"
import { resendVerification } from "@/lib/api/auth"
import { authErrorMessage } from "@/features/auth/authMessages"
import { CHECK_INBOX, VERIFICATION_REASON, VERIFICATION_UNLOCKS } from "@/features/auth/verificationCopy"

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
  const mode = mailMode(user.emailDelivery)
  const developer = mode === "console" || mode === "off"

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
          {developer ? (
            // Development: nothing is e-mailed. Say what is true and how to get the link.
            <Typography variant="body-sm" className="text-muted-foreground" data-testid="dev-verification-hint">
              Development: no e-mail is sent. In <code>backend/</code> run{" "}
              <code className="break-all">{devVerifyCommand(user.email)}</code> to get your link, then open it
              {mode === "console" ? " (the same link is also printed in the API terminal)" : ""}. Verifying lets you{" "}
              {VERIFICATION_UNLOCKS}; browsing works either way.
            </Typography>
          ) : (
            // No wording says a message was sent. With a real provider it says where to look.
            <Typography variant="body-sm" className="text-muted-foreground" data-testid="verification-reason">
              {user.email} is not verified yet. {VERIFICATION_REASON}
            </Typography>
          )}
          {mode === "inbox" && state !== "sent" && ( // after a resend the confirmation below says the same
            <Typography variant="body-sm" className="text-muted-foreground" data-testid="inbox-verification-hint">
              {CHECK_INBOX} for the verification email; it can take a few minutes. If it is not there, use the button
              below to request a new one.
            </Typography>
          )}
          <div role="status" aria-live="polite">
            {state === "sent" && (
              <Typography variant="body-sm">
                {developer
                  ? `A new link was issued. Nothing is e-mailed in development: run the command above${mode === "console" ? ", or read the API terminal" : ""}.`
                  : mode === "inbox"
                    ? `A new verification link was requested. ${CHECK_INBOX}; it can take a few minutes. Only the newest link works.`
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
