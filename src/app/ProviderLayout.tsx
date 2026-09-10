import { MapPin } from "lucide-react"
import { Link, Outlet } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { routes } from "@/config/routes"

/**
 * Shell for the provider/business experience (dashboard, listing creation).
 * Deliberately distinct from ConsumerLayout — no marketing chrome, no
 * bottom tab bar — per Master Spec §15 "keep consumer, provider and admin
 * layouts logically separated." Content built in a later phase.
 */
function ProviderLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-secondary/30">
      <header className="border-b border-border bg-background">
        <Container>
          <Stack direction="row" align="center" justify="between" gap={4} className="h-14">
            <Link to={routes.home} className="flex items-center gap-2" aria-label="Back to B-17 Portal">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
              </span>
              <Typography as="span" variant="label" className="text-muted-foreground">
                B-17 Portal · Provider
              </Typography>
            </Link>
          </Stack>
        </Container>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

export { ProviderLayout }
