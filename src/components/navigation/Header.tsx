import { MapPin, Search, Store, User } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { DesktopNav } from "@/components/navigation/DesktopNav"
import { useAuth } from "@/hooks/useAuth"
import { routes } from "@/config/routes"
import { site } from "@/data/site"

/** Sticky global header: brand, desktop nav, search entry, auth entry. */
function Header() {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-sticky border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <Container>
        <Stack direction="row" align="center" justify="between" gap={4} className="h-16">
          <Link to={routes.home} className="flex min-h-11 shrink-0 items-center gap-2" aria-label={`${site.name} home`}>
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MapPin className="size-4.5" aria-hidden="true" />
            </span>
            <Typography as="span" variant="h3" className="text-lg sm:text-xl">
              {site.name}
            </Typography>
          </Link>

          <DesktopNav className="hidden lg:flex" />

          <Stack direction="row" align="center" gap={2} className="shrink-0">
            <Button asChild variant="ghost" size="icon" aria-label="Search">
              <Link to={routes.search}>
                <Search />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to={routes.providerDashboard} aria-label="List Your Business">
                <Store />
                {/* Icon-only until `xl`: with Food added to the nav, the full label no longer fits beside it at lg. */}
                <span className="hidden xl:inline">List Your Business</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link to={user ? routes.profile : routes.login}>
                <User />
                <span className="max-w-32 truncate">{user ? user.name : "Log in"}</span>
              </Link>
            </Button>
          </Stack>
        </Stack>
      </Container>
    </header>
  )
}

export { Header }
