import { MapPin } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Divider } from "@/components/foundation/Divider"
import { footerNav, footerFutureModules } from "@/config/navigation"
import { routes } from "@/config/routes"
import { site } from "@/data/site"

/** Global footer: brand recap, section links, future-module teaser. */
function Footer() {
  return (
    <footer className="border-t border-border bg-secondary/40 pb-20 lg:pb-0">
      <Container className="py-12">
        <Stack direction="row" wrap justify="between" gap={8}>
          <Stack gap={3} className="max-w-sm">
            <Link to={routes.home} className="flex items-center gap-2" aria-label={`${site.name} home`}>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MapPin className="size-4" aria-hidden="true" />
              </span>
              <Typography as="span" variant="h3" className="text-base">
                {site.name}
              </Typography>
            </Link>
            <Typography variant="body-sm" className="text-muted-foreground">
              {site.tagline}
            </Typography>
          </Stack>

          <Stack gap={3}>
            <Typography variant="label">Explore</Typography>
            <Stack as="ul" gap={2}>
              {footerNav.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </Stack>
          </Stack>

          <Stack gap={3}>
            <Typography variant="label">For Providers</Typography>
            <Stack as="ul" gap={2}>
              <li>
                <Link
                  to={routes.providerDashboard}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  List Your Business / Service
                </Link>
              </li>
            </Stack>
          </Stack>

          <Stack gap={3}>
            <Typography variant="label">Coming Soon</Typography>
            <Stack as="ul" gap={2}>
              {footerFutureModules.map((item) => (
                <li key={item.label}>
                  <Link
                    to={item.path}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </Stack>
          </Stack>
        </Stack>

        <Divider className="my-8" />

        <Typography variant="caption">
          {site.name} is a clickable prototype. Listings, contact details and figures shown are
          placeholder demo data, not real businesses or offers.
        </Typography>
      </Container>
    </footer>
  )
}

export { Footer }
