import { WorkspaceTabs } from "@/components/navigation/WorkspaceTabs"
import { routes } from "@/config/routes"

const tabs = [
  { label: "Overview", path: routes.profile, end: true },
  { label: "Saved", path: routes.profileSaved },
  { label: "My Requests", path: routes.profileRequests },
  { label: "Grocery Orders", path: routes.profileGrocery },
]

/** Account sub-navigation (Phase 9C) — Overview/Saved/My Requests/Grocery Orders. Shares the workspace tab row with the Professional nav. */
function ResidentNav() {
  return <WorkspaceTabs label="Account" tabs={tabs} />
}

export { ResidentNav }
