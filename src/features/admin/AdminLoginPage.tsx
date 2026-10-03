import { useLocation, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { ShieldCheck } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useAdminAuth } from "@/hooks/useAdminAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

interface AdminLoginLocationState {
  from?: string
}

/**
 * Admin Login (Master Spec §17) — a single demo-authentication entry point,
 * fully separate from the customer Login/Register screen.
 */
function AdminLoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { loginAsAdmin } = useAdminAuth()
  const state = (location.state ?? {}) as AdminLoginLocationState

  function handleContinue() {
    loginAsAdmin()
    navigate(state.from ?? routes.adminDashboard, { replace: true })
  }

  return (
    <Container className="py-16 sm:py-24">
      <motion.div {...fadeUp} className="mx-auto max-w-sm">
        <Stack align="center" gap={4} className="text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <Stack gap={2}>
            <Typography variant="h1">Admin Login</Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              Demo Admin access for reviewing and moderating listings. No real account or
              credentials are required for this prototype.
            </Typography>
          </Stack>
          <Button size="lg" className="h-11 w-full" onClick={handleContinue}>
            Continue as Admin (Demo)
          </Button>
          <Typography variant="caption" className="text-muted-foreground">
            Demo login — no real admin account is created.
          </Typography>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { AdminLoginPage }
