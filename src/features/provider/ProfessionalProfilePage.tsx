import { Link, useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { UserRound, LogOut, Wrench, Building2, KeyRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useListingsStore, selectListingsBySubmitter } from "@/state/listingsStore"
import { useAuth } from "@/hooks/useAuth"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes, providerProfilePath, businessProfilePath, propertyDetailsPath } from "@/config/routes"
import { fadeUp } from "@/lib/motion"
import type { PendingListing } from "@/types/listing"

const kindMeta: Record<PendingListing["kind"], { label: string; icon: typeof Wrench }> = {
  provider: { label: "Service / Professional", icon: Wrench },
  business: { label: "Business / Shop", icon: Building2 },
  property: { label: "Property", icon: KeyRound },
}

function listingTitle(listing: PendingListing): string {
  return listing.kind === "property" ? listing.data.title : listing.data.name
}

function publicPathFor(listing: PendingListing): string {
  if (listing.kind === "provider") return providerProfilePath(listing.data.id)
  if (listing.kind === "business") return businessProfilePath(listing.data.id)
  return propertyDetailsPath(listing.data.id)
}

/**
 * Professional Profile (Phase 9D) — uses only what demo auth and the
 * listings store actually contain: a name and the professional's own
 * submissions. No verification documents, bank info, subscription info,
 * team permissions, or analytics — those belong to later phases.
 */
function ProfessionalProfilePage() {
  const user = useRequireAuth()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { listings } = useListingsStore()

  if (!user) return null

  const myListings = selectListingsBySubmitter(listings, user.name)
  const kinds = Array.from(new Set(myListings.map((l) => l.kind)))
  const approvedListings = myListings.filter((l) => l.status === "approved")

  function handleLogout() {
    logout()
    navigate(routes.home)
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Typography variant="h1">Profile</Typography>

          <Card variant="workspace" className="flex-row items-center gap-3">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={0} className="min-w-0">
              <Typography as="p" variant="label" className="break-words font-heading text-xl font-semibold">
                {user.name}
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in (demo) — no real professional account has been created.
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
                    {kindMeta[kind].label}
                  </Badge>
                ))}
              </Stack>
            </Stack>
          )}

          <Stack gap={2}>
            <Typography as="h2" variant="label" className="font-heading text-lg font-semibold">
              Public listings
            </Typography>
            {approvedListings.length === 0 ? (
              <Typography variant="body-sm" className="text-muted-foreground">
                None of your listings are approved and public yet.
              </Typography>
            ) : (
              <Stack gap={2}>
                {approvedListings.map((listing) => (
                  <Link
                    key={listing.id}
                    to={publicPathFor(listing)}
                    className="flex min-h-11 items-center break-words rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-primary shadow-subtle transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {listingTitle(listing)}
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
