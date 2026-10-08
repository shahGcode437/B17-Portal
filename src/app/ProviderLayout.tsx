import { MapPin } from "lucide-react"
import { Link } from "react-router-dom"
import { RouteOutlet } from "@/app/RouteOutlet"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { ProfessionalNav } from "@/features/provider/ProfessionalNav"
import { routes } from "@/config/routes"

/**
 * Shell for the Professional Workspace (Phase 9D: Overview/Listings/Leads/
 * Profile, plus listing creation/edit/pending flows). Deliberately distinct
 * from ConsumerLayout — no marketing chrome, no bottom tab bar — per Master
 * Spec §15 "keep consumer, provider and admin layouts logically separated."
 * One shared shell for every listing kind, not a separate app per profession.
 */
function ProviderLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-secondary/30">
      <header className="border-b border-border bg-background">
        <Container>
          <Stack direction="row" align="center" justify="between" gap={4} className="h-14">
            <Link to={routes.home} className="flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Back to B-17 Portal">
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
      <Container className="pt-3">
        <ProfessionalNav />
      </Container>
      <main className="flex-1">
        <RouteOutlet />
      </main>
    </div>
  )
}

export { ProviderLayout }
