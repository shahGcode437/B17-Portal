import { useNavigate } from "react-router-dom"
import { PenLine } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { EmptyState } from "@/components/feedback/EmptyState"
import { routes } from "@/config/routes"

interface ListingWritesSoonProps {
  title: string
}

/**
 * What the create / edit / "submitted" listing pages show until Phase 12H wires them to the API.
 *
 * Before Phase 12G these forms saved into a browser-local list that nothing else read, then told the
 * professional their listing was "submitted" - a success that never reached the server (the very
 * thing the presentation exposed). Now that the dashboard shows the REAL listings, a form that only
 * pretends to save would put a listing on screen that does not exist. So the pages say plainly that
 * the feature is not available yet. The form components and their tests are kept for the 12H wiring.
 */
function ListingWritesSoon({ title }: ListingWritesSoonProps) {
  const navigate = useNavigate()
  return (
    <Container className="py-16">
      <EmptyState
        headingLevel={1}
        icon={PenLine}
        title={title}
        description="Creating, editing and archiving listings from here is coming soon. Your existing listings and their review status are shown under Listings."
        actionLabel="Back to My Listings"
        onAction={() => navigate(routes.providerListings)}
      />
    </Container>
  )
}

export { ListingWritesSoon }
