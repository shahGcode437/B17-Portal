import { Link, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { UserRound, LogOut } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ReadError } from "@/components/feedback/ReadError"
import { useOwnerListings } from "@/hooks/useWorkspaceReads"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Professional Profile (Phase 9D) - what the session and the account's own listings actually say:
 * a name, an e-mail and (Phase 12G) the REAL approved listings read from `GET /users/me/listings`.
 * No verification documents, bank info, subscription info, team permissions, or analytics - those
 * belong to later phases.
 */
function ProfessionalProfilePage() {
  const user = useRequireAuth()
  const { logout } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()
  const listings = useOwnerListings("approved")

  if (!user) return null

  const kinds = Array.from(new Set(listings.items.map((l) => l.typeLabel)))

  async function handleLogout() {
    try {
      await logout()
      navigate(routes.home)
    } catch {
      show("Couldn't log out — check your connection and try again.", { tone: "error" })
    }
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Typography variant="h1">Profile</Typography>

          <VerificationNotice />

          <Card variant="workspace" className="flex-row items-center gap-3">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={0} className="min-w-0">
              <Typography as="p" variant="label" className="break-words font-heading text-xl font-semibold">
                {user.displayName}
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                {user.email}
              </Typography>
            </Stack>
          </Card>

          {kinds.length > 0 && (
            <Stack gap={2}>
              <Typography as="h2" variant="label" className="font-heading text-lg font-semibold">
                Listing types
              </Typography>
              <Stack direction="row" wrap gap={2}>
                {kinds.map((kind) => (
                  <Badge key={kind} variant="outline" className="gap-1 font-normal">
                    {kind}
                  </Badge>
                ))}
              </Stack>
            </Stack>
          )}

          <Stack gap={2}>
            <Typography as="h2" variant="label" className="font-heading text-lg font-semibold">
              Public listings
            </Typography>
            {listings.loading ? (
              <Typography variant="body-sm" role="status" className="text-muted-foreground">
                Loading your listings…
              </Typography>
            ) : listings.error ? (
              <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listings" />
            ) : listings.items.length === 0 ? (
              <Typography variant="body-sm" className="text-muted-foreground">
                None of your listings are approved and public yet.
              </Typography>
            ) : (
              <Stack gap={2}>
                {listings.items.map((listing) => (
                  <Link
                    key={listing.id}
                    to={listing.publicPath ?? routes.providerListings}
                    className="flex min-h-11 items-center break-words rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-primary shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {listing.title}
                  </Link>
                ))}
              </Stack>
            )}
          </Stack>

          <Button variant="outline" className="h-11 w-fit" onClick={handleLogout}>
            <LogOut />
            Log Out
          </Button>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ProfessionalProfilePage }
