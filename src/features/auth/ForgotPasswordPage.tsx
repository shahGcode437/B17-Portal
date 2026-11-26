import { mailMode, type MailMode } from "@/config/devMail"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { z } from "zod"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { routes } from "@/config/routes"
import { forgotPassword } from "@/lib/api/auth"
import { isApiError } from "@/lib/api/errors"
import { zodResolver } from "@/lib/zodResolver"
import { FieldError, FormAlert } from "@/features/auth/AuthForms"
import { AuthNotice, AuthShell } from "@/features/auth/AuthShell"
import { authErrorMessage } from "@/features/auth/authMessages"
import { CHECK_INBOX } from "@/features/auth/verificationCopy"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(320, "That email address is too long."),
})
type Values = z.infer<typeof schema>

/**
 * Forgot password (Phase 12C). The backend answers `202 accepted` whether or not the account exists,
 * and so does this screen: ONE neutral confirmation, identical for every address, never reworded by
 * the response, its timing or anything inferred about the account. Only rate limiting and a network
 * failure produce a different message — they say nothing about the account.
 *
 * The wording says a link was REQUESTED, never that it was sent, delivered or is on its way. What is added depends
 * on how the SERVER says it handles mail (`mailMode`), which comes from configuration and is identical for every
 * address: with a real provider, where to look; in development, that nothing is e-mailed.
 */
function ForgotPasswordPage() {
  /** `null` until a request was accepted; then how to word the confirmation. */
  const [accepted, setAccepted] = useState<MailMode | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      setAccepted(mailMode(await forgotPassword(values.email)))
    } catch (cause) {
      // A 422 for a malformed address is shown as the same neutral outcome only if the server says
      // "accepted"; any rejection that is not rate limiting / network is a generic failure.
      setFormError(isApiError(cause) && cause.status === 422 ? "Enter a valid email address." : authErrorMessage(cause))
    }
  }

  return (
    <AuthShell>
      <Stack gap={6}>
        <Stack gap={2}>
          <Typography variant="h1">Forgot password</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Enter your email address to request a link to reset your password.
          </Typography>
        </Stack>

        {accepted ? (
          <AuthNotice role="status">
            <Typography variant="body-sm">
              If an account exists for that email address, a password reset link was requested for it. Reset links
              expire after one hour.
            </Typography>
            {accepted === "inbox" && (
              <Typography variant="body-sm" className="mt-2 text-muted-foreground" data-testid="inbox-reset-hint">
                {CHECK_INBOX}; it can take a few minutes. If nothing arrives, wait a little and request a new link
                from the log in page. Only the newest link works.
              </Typography>
            )}
            {(accepted === "console" || accepted === "off") && (
              <Typography variant="body-sm" className="mt-2 text-muted-foreground" data-testid="dev-reset-hint">
                {accepted === "console"
                  ? "Development: no e-mail is sent. The reset link is printed in the API terminal."
                  : "Development: no e-mail is sent. E-mail delivery is switched off, so no reset link is shown anywhere."}
              </Typography>
            )}
          </AuthNotice>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <Stack gap={4}>
              <FormAlert message={formError} />
              <Stack gap={2}>
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "forgot-email-error" : undefined}
                  {...register("email")}
                />
                <FieldError id="forgot-email-error" message={errors.email?.message} />
              </Stack>
              <Button type="submit" size="lg" disabled={isSubmitting} className="h-11 text-base font-semibold">
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>
            </Stack>
          </form>
        )}

        <Typography variant="body-sm" className="text-center">
          <Link
            to={routes.login}
            className="inline-flex min-h-11 items-center rounded px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to log in
          </Link>
        </Typography>
      </Stack>
    </AuthShell>
  )
}

export { ForgotPasswordPage }
