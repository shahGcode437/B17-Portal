import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { routes } from "@/config/routes"

const items = [
  { label: "Overview", path: routes.profile },
  { label: "Saved", path: routes.profileSaved },
  { label: "My Requests", path: routes.profileRequests },
]

/** Account sub-navigation (Phase 9C) — Overview/Saved/My Requests. Plain NavLinks, fully keyboard operable. */
function ResidentNav() {
  return (
    <nav aria-label="Account" className="border-b border-border">
      <ul className="flex gap-1">
        {items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === routes.profile}
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

export { ResidentNav }
