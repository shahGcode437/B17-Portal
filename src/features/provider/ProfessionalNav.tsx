import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"

const items = [
  { label: "Overview", path: routes.providerDashboard },
  { label: "Listings", path: routes.providerListings },
  { label: "Leads", path: routes.providerLeads },
  { label: "Profile", path: routes.professionalProfile },
]

/**
 * Professional Workspace navigation (Phase 9D) — Overview/Listings/Leads/
 * Profile. Lives only inside `ProviderLayout`, entirely separate from the
 * consumer Header/MobileNav (Master Spec §15 — keep layouts separated).
 */
function ProfessionalNav() {
  return (
    <nav aria-label="Professional Workspace" className="border-b border-border">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === routes.providerDashboard}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center rounded-t-lg border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive && "border-primary text-foreground"
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export { ProfessionalNav }
