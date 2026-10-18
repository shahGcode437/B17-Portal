import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { motion } from "motion/react"
import { z } from "zod"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { routes } from "@/config/routes"
import { forgotPassword } from "@/lib/api/auth"
import { isApiError } from "@/lib/api/errors"
import { zodResolver } from "@/lib/zodResolver"
import { fadeUp } from "@/lib/motion"
import { FieldError, FormAlert } from "@/features/auth/AuthForms"
import { authErrorMessage } from "@/features/auth/authMessages"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(320, "That email address is too long."),
})
type Values = z.infer<typeof schema>

/**
 * Forgot password (Phase 12C). The backend answers `202 accepted` whether or not the account exists,
 * and so does this screen: ONE neutral confirmation, identical for every address, never reworded by
 * the response, its timing or anything inferred about the account. Only rate limiting and a network
 * failure produce a different message — they say nothing about the account.
 */
function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await forgotPassword(values.email)
      setSent(true)
    } catch (cause) {
      // A 422 for a malformed address is shown as the same neutral outcome only if the server says
      // "accepted"; any rejection that is not rate limiting / network is a generic failure.
      setFormError(isApiError(cause) && cause.status === 422 ? "Enter a valid email address." : authErrorMessage(cause))
    }
  }

  return (
    <Container className="py-12 sm:py-20">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack gap={6}>
          <Stack gap={2} className="text-center">
            <Typography variant="h1">Forgot password</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Enter your email address and we'll send a link to reset your password.
            </Typography>
          </Stack>

          {sent ? (
            <div role="status" className="rounded-lg border border-border bg-muted px-4 py-3">
              <Typography variant="body-sm">
                If an account exists for that email address, a password reset link is on its way. The link expires
                after one hour.
              </Typography>
            </div>
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
                <Button type="submit" size="lg" disabled={isSubmitting}>
                  {isSubmitting ? "Sending…" : "Send reset link"}
                </Button>
              </Stack>
            </form>
          )}

          <Typography variant="body-sm" className="text-center">
            <Link to={routes.login} className="text-primary underline-offset-4 hover:underline">
              Back to log in
            </Link>
          </Typography>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ForgotPasswordPage }
