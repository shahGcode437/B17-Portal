import { MapPin, LayoutDashboard, ClipboardList, Newspaper, LogOut, ShoppingBasket, Tags, Users } from "lucide-react"
import { Link, NavLink } from "react-router-dom"
import { RouteOutlet } from "@/app/RouteOutlet"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { SkipLink } from "@/components/navigation/SkipLink"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"
import { headerFocusClass } from "@/features/admin/adminStyles"
import { logoutErrorMessage } from "@/features/auth/authMessages"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/hooks/useToast"
import { canWorkGroceryOrders } from "@/lib/staffAccess"

const adminNav = [
  { label: "Dashboard", path: routes.adminDashboard, icon: LayoutDashboard, end: true },
  { label: "Listings", path: routes.adminModeration, icon: ClipboardList, end: false },
  { label: "Categories", path: routes.adminCategories, icon: Tags, end: false },
  { label: "News & Updates", path: routes.adminContent, icon: Newspaper, end: false },
  { label: "Staff", path: routes.adminStaff, icon: Users, end: false },
]

const groceryNav = { label: "Grocery", path: routes.adminGrocery, icon: ShoppingBasket, end: false }

/**
 * Shell for the administration experience (moderation, content management).
 * Prioritizes information density over marketing polish, per UI/UX Spec §19.
 * A compact nav row (not a sidebar) links the two management areas.
 */
function AdminLayout() {
  const { user, logout } = useAuth()
  const { show } = useToast()
  const admin = user?.roles.includes("admin") ? user : null
  const grocery = canWorkGroceryOrders(user)
  // A Grocery Moderator is shown their one area only. Anyone else sees what they saw before, plus
  // Grocery when they may work it. Navigation is a convenience: the gates and the API decide access.
  const groceryOnly = grocery && !admin
  const items = groceryOnly ? [groceryNav] : grocery ? [...adminNav, groceryNav] : adminNav

  return (
    <div className="atmos-canvas flex min-h-svh flex-col">
      <SkipLink />
      {/* Admin keeps its dense dark identity bar (DESIGN_SYSTEM §13), now sitting on the shared canvas. */}
      <header className="sticky top-0 z-sticky border-b border-border bg-foreground text-background">
        <Container>
          <Stack direction="row" align="center" justify="between" gap={2} wrap className="min-h-14 py-1 sm:gap-4">
            <Link
              to={routes.home}
              className={cn("flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-md", headerFocusClass)}
              aria-label="Back to B-17 Portal"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
              </span>
              <Typography as="span" variant="label" className="hidden text-background sm:inline">
                {groceryOnly ? "B-17 Portal · Staff" : "B-17 Portal · Admin"}
              </Typography>
            </Link>
            <nav aria-label="Admin" className="ml-auto flex flex-wrap items-center justify-end gap-0 sm:gap-1">
              {items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-background/70 transition-colors hover:bg-background/10 hover:text-background",
                      headerFocusClass,
                      isActive && "bg-background/15 font-semibold text-background"
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  <span className="sr-only lg:not-sr-only">{item.label}</span>
                </NavLink>
              ))}
              {(admin || grocery) && (
                // Real logout (revokes the server session). The admin gate then sends the visitor to
                // Admin Login — no extra navigation here.
                <button
                  type="button"
                  onClick={() => {
                    logout().catch((cause: unknown) => show(logoutErrorMessage(cause), { tone: "error" }))
                  }}
                  className={cn(
                    "ml-1 flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border-l border-background/20 px-2.5 text-sm font-medium text-background/70 transition-colors hover:bg-background/10 hover:text-background",
                    headerFocusClass
                  )}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  <span className="sr-only lg:not-sr-only">Log out</span>
                </button>
              )}
            </nav>
          </Stack>
        </Container>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <RouteOutlet />
      </main>
    </div>
  )
}

export { AdminLayout }
