import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { mobileNav } from "@/config/navigation"

/** Fixed bottom tab bar (mobile only — UI/UX Spec §6, §23). Max 5 destinations. */
function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-sticky border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 lg:hidden"
    >
      <ul className="flex items-stretch justify-between">
        {mobileNav.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.path} className="flex-1">
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors",
                    isActive && "text-primary"
                  )
                }
              >
                {Icon && <Icon className="size-5" aria-hidden="true" />}
                {item.label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export { MobileNav }
