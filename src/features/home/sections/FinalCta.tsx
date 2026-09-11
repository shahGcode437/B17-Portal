import { Search } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { routes } from "@/config/routes"

/** Closing discovery prompt — not a generic marketing CTA. */
function FinalCta() {
  return (
    <section className="border-t border-border bg-primary/5">
      <Container className="py-16 text-center">
        <Stack align="center" gap={3} className="mx-auto max-w-xl">
          <Typography variant="h2">Still looking for something specific?</Typography>
          <Typography variant="body" className="text-muted-foreground">
            Search across services, businesses, tutors, properties and news — everything local to
            B-17, in one place.
          </Typography>
          <Button asChild size="lg" className="mt-2">
            <Link to={routes.search}>
              <Search />
              Search B-17 Portal
            </Link>
          </Button>
        </Stack>
      </Container>
    </section>
  )
}

export { FinalCta }
