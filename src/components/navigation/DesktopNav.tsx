import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { desktopNav } from "@/config/navigation"

interface DesktopNavProps extends React.ComponentProps<"nav"> {}

/** Primary horizontal navigation (tablet/desktop). Hidden on mobile — see MobileNav. */
function DesktopNav({ className, ...props }: DesktopNavProps) {
  return (
    <nav aria-label="Primary" className={cn("items-center gap-1", className)} {...props}>
      <ul className="flex items-center gap-1">
        {desktopNav.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground"
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

export { DesktopNav }
