import { useEffect, useRef } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

interface WorkspaceTab {
  label: string
  path: string
  /** Match only the exact path (for index tabs like Overview). */
  end?: boolean
}

interface WorkspaceTabsProps {
  label: string
  tabs: WorkspaceTab[]
}

/**
 * Underline-tab row shared by the Resident account and the Professional
 * Workspace (DESIGN_SYSTEM.md §12/§17). Tabs are 44px tall, never wrap, and
 * scroll horizontally (scrollbar hidden) if a very narrow viewport can't fit
 * them — the active tab is scrolled into view on navigation so it is never
 * the one that's cut off. The focus ring is drawn inset because the scroll
 * container would clip an outer one. The active tab is marked by
 * `aria-current` (via NavLink), a heavier weight and the underline — not by
 * color alone.
 */
function WorkspaceTabs({ label, tabs }: WorkspaceTabsProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [pathname])

  return (
    <nav
      aria-label={label}
      className="glass-panel sticky top-0 z-sticky rounded-2xl p-1 shadow-subtle"
    >
      <ul ref={listRef} className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <li key={tab.path} className="shrink-0">
            <NavLink
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "relative inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4",
                  isActive && "bg-card font-semibold text-foreground shadow-subtle"
                )
              }
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export { WorkspaceTabs }
export type { WorkspaceTab }
