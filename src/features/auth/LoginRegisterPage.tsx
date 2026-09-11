import { useState } from "react"
import { useForm } from "react-hook-form"
import { useLocation, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { z } from "zod"
import { LogIn, UserPlus } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { routes, providerProfilePath } from "@/config/routes"
import { zodResolver } from "@/lib/zodResolver"
import { fadeUp } from "@/lib/motion"

const authSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter at least 2 characters.")
    .max(60, "That name is a bit too long."),
})
type AuthValues = z.infer<typeof authSchema>

interface LoginLocationState {
  from?: string
  providerId?: string
}

/**
 * Shared Login/Register screen (Master Spec §17). Demo-only — the two modes
 * collect the same single name field and both call the same simulated
 * `login()`; the toggle exists for a complete-feeling UX, not different
 * behavior. Preserves and resumes an interrupted Request Service intent.
 */
function LoginRegisterPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login } = useAuth()
  const { show } = useToast()
  const state = (location.state ?? {}) as LoginLocationState

  const [mode, setMode] = useState<"login" | "register">(
    location.pathname === routes.register ? "register" : "login"
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { name: "" },
  })

  function onSubmit(values: AuthValues) {
    login(values.name)
    show(`Signed in as ${values.name.trim()} (demo)`)

    if (state.providerId) {
      navigate(providerProfilePath(state.providerId), {
        replace: true,
        state: { openRequestFor: state.providerId },
      })
      return
    }
    navigate(state.from ?? routes.home, { replace: true })
  }

  return (
    <Container className="py-12 sm:py-20">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack gap={6}>
          <Stack gap={2} className="text-center">
            <Typography variant="h1">{mode === "login" ? "Log In" : "Create Account"}</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {mode === "login"
                ? "Welcome back — enter your name to continue."
                : "Create a demo account to continue."}
            </Typography>
          </Stack>

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

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <Stack gap={4}>
              <Stack gap={2}>
                <Label htmlFor="auth-name">Your name</Label>
                <Input
                  id="auth-name"
                  autoComplete="name"
                  placeholder="e.g. Ayesha Khan"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "auth-name-error" : undefined}
                  {...register("name")}
                />
                {errors.name && (
                  <Typography
                    id="auth-name-error"
                    variant="caption"
                    className="text-destructive"
                    role="alert"
                  >
                    {errors.name.message}
                  </Typography>
                )}
              </Stack>

              <Button type="submit" size="lg" disabled={isSubmitting}>
                {mode === "login" ? <LogIn /> : <UserPlus />}
                {mode === "login" ? "Log In" : "Create Account"}
              </Button>
            </Stack>
          </form>

          <Typography variant="caption" className="text-center text-muted-foreground">
            Demo login — no real account is created.
          </Typography>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { LoginRegisterPage }
