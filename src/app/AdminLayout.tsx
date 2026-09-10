import { MapPin } from "lucide-react"
import { Link, Outlet } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { routes } from "@/config/routes"

/**
 * Shell for the administration experience (moderation, content management).
 * Prioritizes information density over marketing polish, per UI/UX Spec §19.
 * A Sidebar/KPI layout is added when Admin screens are built (later phase).
 */
function AdminLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-secondary/30">
      <header className="border-b border-border bg-foreground text-background">
        <Container>
          <Stack direction="row" align="center" justify="between" gap={4} className="h-14">
            <Link to={routes.home} className="flex items-center gap-2" aria-label="Back to B-17 Portal">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
              </span>
              <Typography as="span" variant="label" className="text-background">
                B-17 Portal · Admin
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

export { AdminLayout }
