import { Loader2, ShieldAlert, Store, WifiOff } from "lucide-react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { EmptyState } from "@/components/feedback/EmptyState"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useMutation } from "@/hooks/useMutation"
import { createProfessionalProfile } from "@/lib/api/writes/professional"
import { userMessageFor } from "@/lib/api/writeErrors"
import { routes } from "@/config/routes"

type Requirement = "authenticated" | "professional" | "admin"

interface AuthGateProps {
  requires?: Requirement
}

/**
 * Route guard (Phase 12C). It distinguishes the four auth states and NEVER decides before
 * `/auth/me` has answered:
 *
 *  - loading       → a neutral status (no redirect, no flash of protected content or of Log In);
 *  - unavailable   → "can't reach the server" with a retry (not mistaken for "logged out");
 *  - anonymous     → redirect to Log In (Admin Login for admin routes) remembering where we were;
 *  - authenticated → the capability check: `professional` needs the backend's professional summary,
 *                    `admin` needs the `admin` role from `/auth/me`.
 *
 * These checks are UX only. The API (require_verified_user / require_professional / require_admin
 * with its session-freshness rule) is the authority on every request.
 */
function AuthGate({ requires = "authenticated" }: AuthGateProps) {
  const { status, user, retryBootstrap, refreshMe } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const createProfile = useMutation(async () => {
    await createProfessionalProfile()
    await refreshMe({ fresh: true })
  })

  if (status === "loading") {
    return (
      <div role="status" className="flex min-h-[50svh] flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <Typography variant="body-sm" className="text-muted-foreground">
          Checking your session
        </Typography>
      </div>
    )
  }

  if (status === "unavailable") {
    return (
      <Container>
        <EmptyState
          icon={WifiOff}
          headingLevel={1}
          title="We can't reach the server"
          description="Check your connection and try again. Your account is unchanged."
          actionLabel="Try again"
          onAction={retryBootstrap}
          secondaryActionLabel="Back to home"
          onSecondaryAction={() => navigate(routes.home)}
        />
      </Container>
    )
  }

  if (status === "anonymous" || !user) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to={requires === "admin" ? routes.adminLogin : routes.login} replace state={{ from }} />
  }

  if (requires === "admin" && !user.roles.includes("admin")) {
    return (
      <Container>
        <EmptyState
          icon={ShieldAlert}
          headingLevel={1}
          title="Admin access only"
          description="This account is not an administrator. Admin access is granted by the B-17 team, never from this screen."
          actionLabel="Back to home"
          onAction={() => navigate(routes.home)}
        />
      </Container>
    )
  }

  if (requires === "professional" && !user.professional) {
    const copy = createProfile.status === "error" ? userMessageFor(createProfile.error, "create-professional-profile") : null
    const needsVerification = createProfile.status === "error" && createProfile.error.code === "email_not_verified"
    return (
      <Container>
        <Stack align="center" gap={4} className="mx-auto max-w-md py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Store className="size-6" aria-hidden="true" />
          </span>
          <Typography as="h1" variant="h3">
            Professional profile needed
          </Typography>
          <Typography variant="body" className="text-muted-foreground">
            The Professional Workspace is for accounts with a professional profile. One click sets it up on the Free plan;
            you can upgrade later. You cannot grant yourself an admin role.
          </Typography>
          <Stack direction="row" wrap gap={2} justify="center">
            <Button
              size="lg"
              onClick={() => void createProfile.mutate(undefined).catch(() => undefined)}
              disabled={createProfile.pending || needsVerification}
            >
              {createProfile.pending ? "Setting up…" : "Create a professional profile"}
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate(routes.home)}>
              Back to home
            </Button>
          </Stack>
          {copy && (
            <Typography variant="body-sm" role="alert" className="text-destructive">
              {copy.title}
              {copy.description ? ` — ${copy.description}` : ""}
            </Typography>
          )}
        </Stack>
      </Container>
    )
  }

  return <Outlet />
}

export { AuthGate }
