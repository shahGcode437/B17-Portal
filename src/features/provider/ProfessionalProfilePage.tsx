import { Link, useNavigate } from "react-router-dom"
import { UserRound, LogOut, Store } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ReadError } from "@/components/feedback/ReadError"
import { PageHeader } from "@/components/workspace/PageHeader"
import { WorkspaceSection } from "@/components/workspace/WorkspaceSection"
import { useOwnerListings } from "@/hooks/useWorkspaceReads"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { VerificationNotice } from "@/features/auth/VerificationNotice"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"

/**
 * Professional Profile (Phase 9D; VR4 visuals) — what the session and the account's own listings
 * actually say: a name, an e-mail and the REAL approved listings. No bio, phone, WhatsApp, business
 * hours or public contact preferences: ProfessionalProfile's contact fields are Phase 13B and nothing
 * fake is shown as editable.
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
      <div className="mx-auto max-w-3xl">
        <Stack gap={6}>
          <PageHeader
            icon={UserRound}
            eyebrow="Professional"
            title="Profile"
            description="Your account identity and the listings that are approved and public today."
            actions={
              <Button variant="outline" className="h-11" onClick={handleLogout}>
                <LogOut />
                Log Out
              </Button>
            }
          />

          <VerificationNotice />

          <Card variant="workspace" className="flex-row items-center gap-4 rounded-2xl p-5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground ring-1 ring-primary/30">
              <UserRound className="size-7" aria-hidden="true" />
            </span>
            <Stack gap={1} className="min-w-0">
              <Typography as="p" variant="label" className="break-words font-heading text-xl font-semibold">
                {user.displayName}
              </Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                {user.email}
              </Typography>
              {kinds.length > 0 && (
                <Stack direction="row" wrap gap={2} className="mt-2">
                  {kinds.map((kind) => (
                    <Badge key={kind} variant="secondary" className="rounded-full font-normal">
                      {kind}
                    </Badge>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>

          <WorkspaceSection title="Public listings" count={listings.items.length}>
            {listings.loading ? (
              <Typography variant="body-sm" role="status" className="text-muted-foreground">
                Loading your listings…
              </Typography>
            ) : listings.error ? (
              <ReadError error={listings.error} onRetry={listings.retry} title="Couldn't load your listings" />
            ) : listings.items.length === 0 ? (
              <Card variant="workspace" className="items-center gap-3 rounded-2xl border-dashed bg-muted/40 py-8 text-center shadow-none">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-background/70 text-muted-foreground ring-1 ring-border">
                  <Store className="size-5" aria-hidden="true" />
                </span>
                <Typography variant="body-sm" className="text-muted-foreground">
                  None of your listings are approved and public yet.
                </Typography>
              </Card>
            ) : (
              <Stack gap={2}>
                {listings.items.map((listing) => (
                  <Link
                    key={listing.id}
                    to={listing.publicPath ?? routes.providerListings}
                    className="group flex min-h-11 items-center justify-between gap-3 break-words rounded-xl bg-card px-4 py-3 text-sm font-medium text-foreground shadow-subtle ring-1 ring-border transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 break-words">{listing.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground group-hover:text-primary">
                      {listing.typeLabel}
                    </span>
                  </Link>
                ))}
              </Stack>
            )}
          </WorkspaceSection>
        </Stack>
      </div>
    </Container>
  )
}

export { ProfessionalProfilePage }
