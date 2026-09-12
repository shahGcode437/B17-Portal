import { MapPin, Search, Store, User } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { DesktopNav } from "@/components/navigation/DesktopNav"
import { routes } from "@/config/routes"
import { site } from "@/data/site"

/** Sticky global header: brand, desktop nav, search entry, auth entry. */
function Header() {
  return (
    <header className="sticky top-0 z-sticky border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <Container>
        <Stack direction="row" align="center" justify="between" gap={4} className="h-16">
          <Link to={routes.home} className="flex items-center gap-2 shrink-0" aria-label={`${site.name} home`}>
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MapPin className="size-4.5" aria-hidden="true" />
            </span>
            <Typography as="span" variant="h3" className="text-lg sm:text-xl">
              {site.name}
            </Typography>
          </Link>

          <DesktopNav className="hidden md:flex" />

          <Stack direction="row" align="center" gap={2} className="shrink-0">
            <Button asChild variant="ghost" size="icon" aria-label="Search">
              <Link to={routes.search}>
                <Search />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to={routes.providerDashboard}>
                <Store />
                List Your Business
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link to={routes.login}>
                <User />
                Log in
              </Link>
            </Button>
          </Stack>
        </Stack>
      </Container>
    </header>
  )
}

export { Header }
