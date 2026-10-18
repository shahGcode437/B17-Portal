import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { z } from "zod"
import { LogIn, UserPlus } from "lucide-react"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { routes } from "@/config/routes"
import { fieldErrors, isApiError } from "@/lib/api/errors"
import { zodResolver } from "@/lib/zodResolver"
import { PasswordInput } from "@/features/auth/PasswordInput"
import { authErrorMessage } from "@/features/auth/authMessages"

/** Client-side validation is UX only; the backend's 422 stays authoritative. */
const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(320, "That email address is too long."),
  password: z.string().min(1, "Enter your password.").max(1024, "That password is too long."),
})
type LoginValues = z.infer<typeof loginSchema>

const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Please enter at least 2 characters.")
    .max(60, "That name is a bit too long."),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(320, "That email address is too long.")
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email address."),
  // The stable user-facing policy only. The server's wider screening decides what is acceptable.
  password: z.string().min(10, "Use at least 10 characters.").max(128, "Use at most 128 characters."),
})
type RegisterValues = z.infer<typeof registerSchema>

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <Typography id={id} variant="caption" className="text-destructive" role="alert">
      {message}
    </Typography>
  )
}

function FormAlert({ message }: { message: string | null }) {
  // Always mounted so assistive tech announces the text when it appears.
  return (
    <div role="alert" aria-live="assertive">
      {message && (
        <Typography variant="body-sm" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {message}
        </Typography>
      )}
    </div>
  )
}

/** Maps a backend 422 onto the fields it names; returns true when it did. */
function applyFieldErrors(
  cause: unknown,
  set: (field: "email" | "password" | "displayName", message: string) => void
): boolean {
  if (!isApiError(cause) || cause.status !== 422) return false
  let mapped = false
  for (const [field, message] of Object.entries(fieldErrors(cause))) {
    if (field === "email" || field === "password" || field === "displayName") {
      set(field, message.slice(0, 160))
      mapped = true
    }
  }
  return mapped
}

function LoginForm() {
  const { login } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } })

  async function onSubmit(values: LoginValues) {
    setFormError(null)
    try {
      await login(values.email, values.password)
      // The page redirects as soon as the auth state becomes "authenticated".
    } catch (cause) {
      if (!applyFieldErrors(cause, (field, message) => field !== "displayName" && setError(field, { message }))) {
        setFormError(authErrorMessage(cause))
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack gap={4}>
        <FormAlert message={formError} />
        <Stack gap={2}>
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "auth-email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="auth-email-error" message={errors.email?.message} />
        </Stack>
        <Stack gap={2}>
          <Label htmlFor="auth-password">Password</Label>
          <PasswordInput
            id="auth-password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "auth-password-error" : undefined}
            {...register("password")}
          />
          <FieldError id="auth-password-error" message={errors.password?.message} />
        </Stack>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          <LogIn />
          {isSubmitting ? "Logging in…" : "Log In"}
        </Button>
        <Typography variant="body-sm" className="text-center">
          <Link to={routes.forgotPassword} className="text-primary underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </Typography>
      </Stack>
    </form>
  )
}

function RegisterForm() {
  const { register: registerAccount } = useAuth()
  const { show } = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  })

  async function onSubmit(values: RegisterValues) {
    setFormError(null)
    try {
      await registerAccount({ email: values.email, password: values.password, displayName: values.displayName })
      show("Account created. Check your email to verify your address.")
    } catch (cause) {
      if (isApiError(cause) && cause.code === "email_already_registered") {
        setError("email", { message: authErrorMessage(cause) })
      } else if (!applyFieldErrors(cause, (field, message) => setError(field, { message }))) {
        setFormError(authErrorMessage(cause))
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack gap={4}>
        <FormAlert message={formError} />
        <Stack gap={2}>
          <Label htmlFor="auth-name">Your name</Label>
          <Input
            id="auth-name"
            autoComplete="name"
            placeholder="e.g. Ayesha Khan"
            aria-invalid={!!errors.displayName}
            aria-describedby={errors.displayName ? "auth-name-error" : undefined}
            {...register("displayName")}
          />
          <FieldError id="auth-name-error" message={errors.displayName?.message} />
        </Stack>
        <Stack gap={2}>
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "auth-email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="auth-email-error" message={errors.email?.message} />
        </Stack>
        <Stack gap={2}>
          <Label htmlFor="auth-password">Password</Label>
          <PasswordInput
            id="auth-password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "auth-password-error auth-password-hint" : "auth-password-hint"}
            {...register("password")}
          />
          <Typography id="auth-password-hint" variant="caption">
            10–128 characters. A long passphrase works well.
          </Typography>
          <FieldError id="auth-password-error" message={errors.password?.message} />
        </Stack>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          <UserPlus />
          {isSubmitting ? "Creating account…" : "Create Account"}
        </Button>
      </Stack>
    </form>
  )
}

export { FieldError, FormAlert, LoginForm, RegisterForm }
