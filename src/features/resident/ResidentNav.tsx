import { WorkspaceTabs } from "@/components/navigation/WorkspaceTabs"
import { routes } from "@/config/routes"

const tabs = [
  { label: "Overview", path: routes.profile, end: true },
  { label: "Saved", path: routes.profileSaved },
  { label: "My Requests", path: routes.profileRequests },
]

/** Account sub-navigation (Phase 9C) — Overview/Saved/My Requests. Shares the workspace tab row with the Professional nav. */
function ResidentNav() {
  return <WorkspaceTabs label="Account" tabs={tabs} />
}

export { ResidentNav }
