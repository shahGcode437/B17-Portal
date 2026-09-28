import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"
import { Heart, ClipboardList, LogOut, UserRound } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { CategoryCard } from "@/components/cards/CategoryCard"
import { ResidentNav } from "@/features/resident/ResidentNav"
import { useResidentStore } from "@/state/residentStore"
import { useAuth } from "@/hooks/useAuth"
import { useRequireAuth } from "@/hooks/useRequireAuth"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

/**
 * Resident account overview (Phase 9C) — replaces the former Profile stub.
 * Identity is exactly what demo auth actually provides (a name, nothing
 * else) — no email/phone/avatar is invented. Quick links surface Saved and
 * My Requests counts without duplicating either page's own list.
 */
function ResidentOverviewPage() {
  const user = useRequireAuth()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const savedCount = useResidentStore((state) => state.savedItems.length)
  const requestCount = useResidentStore((state) => state.requests.length)

  if (!user) return null

  function handleLogout() {
    logout()
    navigate(routes.home)
  }

  return (
    <Container className="py-8 sm:py-12">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl">
        <Stack gap={6}>
          <Stack direction="row" align="center" gap={3}>
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" aria-hidden="true" />
            </span>
            <Stack gap={0}>
              <Typography variant="h2">{user.name}</Typography>
              <Typography variant="body-sm" className="text-muted-foreground">
                Signed in (demo) — no real account has been created.
              </Typography>
            </Stack>
          </Stack>

          <ResidentNav />

          <Stack direction="row" gap={4} wrap>
            <div className="w-full sm:w-[calc(50%-0.5rem)]">
              <CategoryCard
                to={routes.profileSaved}
                icon={Heart}
                label="Saved"
                description={`${savedCount} saved item${savedCount === 1 ? "" : "s"}`}
              />
            </div>
            <div className="w-full sm:w-[calc(50%-0.5rem)]">
              <CategoryCard
                to={routes.profileRequests}
                icon={ClipboardList}
                label="My Requests"
                description={`${requestCount} request${requestCount === 1 ? "" : "s"}`}
              />
            </div>
          </Stack>

          <Button variant="outline" className="w-fit" onClick={handleLogout}>
            <LogOut />
            Log Out
          </Button>
        </Stack>
      </motion.div>
    </Container>
  )
}

export { ResidentOverviewPage }
