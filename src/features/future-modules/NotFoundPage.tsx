import { SearchX } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { routes } from "@/config/routes"

/**
 * True 404 for unknown routes (Phase 8D) — distinct from ComingSoonPage,
 * which is reserved for intentionally-deferred future features. An unknown
 * URL isn't a future feature, so it gets its own copy and icon.
 */
function NotFoundPage() {
  return (
    <Container className="py-24">
      <Stack align="center" gap={4} className="mx-auto max-w-md text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <SearchX className="size-6" aria-hidden="true" />
        </span>
        <Typography variant="h2">Page Not Found</Typography>
        <Typography variant="body" className="text-muted-foreground">
          The page you're looking for doesn't exist or may have been moved.
        </Typography>
        <Button asChild className="mt-2">
          <Link to={routes.home}>Back to Home</Link>
        </Button>
      </Stack>
    </Container>
  )
}

export { NotFoundPage }
