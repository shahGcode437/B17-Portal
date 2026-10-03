import { Construction } from "lucide-react"
import { Link } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { routes } from "@/config/routes"

interface ComingSoonPageProps {
  title?: string
}

/**
 * Generic placeholder for routes/modules not yet built. Used both for
 * genuinely future (P2/P3) modules and as a temporary stub for P0/P1
 * screens that this phase only wires up navigation and layout for.
 * Never implies real transactional functionality (Master Spec §18).
 */
function ComingSoonPage({ title = "Coming Soon" }: ComingSoonPageProps) {
  return (
    <Container className="py-24">
      <Stack align="center" gap={4} className="mx-auto max-w-md text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Construction className="size-6" aria-hidden="true" />
        </span>
        <Typography as="h1" variant="h2">
          {title}
        </Typography>
        <Typography variant="body" className="text-muted-foreground">
          This part of the B-17 Portal prototype is still being built. Check back soon.
        </Typography>
        <Button asChild className="mt-2">
          <Link to={routes.home}>Back to Home</Link>
        </Button>
      </Stack>
    </Container>
  )
}

export { ComingSoonPage }
