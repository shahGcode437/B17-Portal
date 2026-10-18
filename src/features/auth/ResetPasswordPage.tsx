import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { z } from "zod"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/useAuth"
import { useReferrerPolicy } from "@/hooks/useReferrerPolicy"
import { routes } from "@/config/routes"
import { resetPassword } from "@/lib/api/auth"
import { fieldErrors, isApiError } from "@/lib/api/errors"
import { clearFragmentToken, takeFragmentToken } from "@/lib/fragmentToken"
import { zodResolver } from "@/lib/zodResolver"
import { fadeUp } from "@/lib/motion"
import { FieldError, FormAlert } from "@/features/auth/AuthForms"
import { PasswordInput } from "@/features/auth/PasswordInput"
import { authErrorMessage } from "@/features/auth/authMessages"

const schema = z
  .object({
    newPassword: z.string().min(10, "Use at least 10 characters.").max(128, "Use at most 128 characters."),
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    path: ["confirm"],
    message: "The two passwords don't match.",
  })
type Values = z.infer<typeof schema>

/**
 * Reset password (Phase 12C). The one-time token arrives in the URL FRAGMENT: it was moved into
 * memory and stripped from the address bar at app start (and again here, idempotently), is held in
 * component state only, is never persisted or logged, and is dropped after use. The page sets
 * `Referrer-Policy: no-referrer`. A successful reset does NOT sign anyone in — the backend revokes
 * the account's sessions and this page stays anonymous and points to Log In.
 */
function ResetPasswordPage() {
  useReferrerPolicy("no-referrer")
  const { refreshMe } = useAuth()
  const [token] = useState(() => takeFragmentToken(routes.resetPassword))
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { newPassword: "", confirm: "" } })

  useEffect(() => () => clearFragmentToken(), [])

  async function onSubmit(values: Values) {
    if (!token) return
    setFormError(null)
    try {
      await resetPassword(token, values.newPassword)
      clearFragmentToken()
      setDone(true)
      void refreshMe({ fresh: true }) // the reset revoked this account's sessions: learn that, don't assume it
    } catch (cause) {
      const mapped = isApiError(cause) && cause.status === 422 ? fieldErrors(cause) : {}
      if (mapped.newPassword) setError("newPassword", { message: mapped.newPassword.slice(0, 160) })
      else setFormError(authErrorMessage(cause))
    }
  }

  return (
    <Container className="py-12 sm:py-20">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack gap={6}>
          <Typography variant="h1" className="text-center">
            Reset password
          </Typography>

          {done ? (
            <Stack gap={4}>
              <div role="status" className="rounded-lg border border-border bg-muted px-4 py-3">
                <Typography variant="body-sm">
                  Your password has been changed. Log in with your new password.
                </Typography>
              </div>
              <Button asChild size="lg">
                <Link to={routes.login}>Go to log in</Link>
              </Button>
            </Stack>
          ) : !token ? (
            <Stack gap={4}>
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                <Typography variant="body-sm" className="text-destructive">
                  This reset link is incomplete or has already been used. Request a new one.
                </Typography>
              </div>
              <Button asChild size="lg" variant="outline">
                <Link to={routes.forgotPassword}>Request a new link</Link>
              </Button>
            </Stack>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Stack gap={4}>
                <FormAlert message={formError} />
                <Stack gap={2}>
                  <Label htmlFor="reset-password">New password</Label>
                  <PasswordInput
                    id="reset-password"
                    autoComplete="new-password"
                    aria-invalid={!!errors.newPassword}
                    aria-describedby={errors.newPassword ? "reset-password-error reset-password-hint" : "reset-password-hint"}
                    {...register("newPassword")}
                  />
                  <Typography id="reset-password-hint" variant="caption">
                    10–128 characters.
                  </Typography>
                  <FieldError id="reset-password-error" message={errors.newPassword?.message} />
                </Stack>
                <Stack gap={2}>
                  <Label htmlFor="reset-confirm">Confirm new password</Label>
                  <PasswordInput
                    id="reset-confirm"
                    autoComplete="new-password"
                    aria-invalid={!!errors.confirm}
                    aria-describedby={errors.confirm ? "reset-confirm-error" : undefined}
                    {...register("confirm")}
                  />
                  <FieldError id="reset-confirm-error" message={errors.confirm?.message} />
                </Stack>
                <Button type="submit" size="lg" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Set new password"}
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ResetPasswordPage }
