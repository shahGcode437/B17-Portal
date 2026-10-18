import { useState } from "react"
import { MailWarning } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { resendVerification } from "@/lib/api/auth"
import { authErrorMessage } from "@/features/auth/authMessages"

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
      className="rounded-lg border border-border bg-muted px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <Typography variant="body-sm" className="font-medium">
            Verify your email address
          </Typography>
          <Typography variant="body-sm" className="text-muted-foreground">
            We sent a link to {user.email}. Verifying lets you list a business and send requests; browsing works
            either way.
          </Typography>
          <div role="status" aria-live="polite">
            {state === "sent" && (
              <Typography variant="body-sm">
                If your email still needs verifying, a new link is on its way.
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
