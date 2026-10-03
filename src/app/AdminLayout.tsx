import { MapPin, LayoutDashboard, ClipboardList, Newspaper } from "lucide-react"
import { Link, NavLink, Outlet } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"
import { headerFocusClass } from "@/features/admin/adminStyles"

const adminNav = [
  { label: "Dashboard", path: routes.adminDashboard, icon: LayoutDashboard, end: true },
  { label: "Listings", path: routes.adminModeration, icon: ClipboardList, end: false },
  { label: "News & Updates", path: routes.adminContent, icon: Newspaper, end: false },
]

/**
 * Shell for the administration experience (moderation, content management).
 * Prioritizes information density over marketing polish, per UI/UX Spec §19.
 * A compact nav row (not a sidebar) links the two management areas.
 */
function AdminLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-secondary/30">
      <header className="border-b border-border bg-foreground text-background">
        <Container>
          <Stack direction="row" align="center" justify="between" gap={4} className="h-14">
            <Link
              to={routes.home}
              className={cn("flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-md", headerFocusClass)}
              aria-label="Back to B-17 Portal"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
              </span>
              <Typography as="span" variant="label" className="hidden text-background sm:inline">
                B-17 Portal · Admin
              </Typography>
            </Link>
            <nav aria-label="Admin" className="flex items-center gap-1">
              {adminNav.map((item) => (
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
                  <span className="sr-only sm:not-sr-only">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </Stack>
        </Container>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

export { AdminLayout }
