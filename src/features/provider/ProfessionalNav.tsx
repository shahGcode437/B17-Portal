import { WorkspaceTabs } from "@/components/navigation/WorkspaceTabs"
import { routes } from "@/config/routes"

const tabs = [
  { label: "Overview", path: routes.providerDashboard, end: true },
  { label: "Listings", path: routes.providerListings },
  { label: "Leads", path: routes.providerLeads },
  { label: "Analytics", path: routes.providerAnalytics },
  { label: "Profile", path: routes.professionalProfile },
]

/**
 * Professional Workspace navigation (Phase 9D; Analytics added Phase 9E) —
 * Overview/Listings/Leads/Analytics/Profile. Lives only inside
 * `ProviderLayout`, entirely separate from the consumer Header/MobileNav
 * (Master Spec §15 — keep layouts separated). The Analytics tab stays
 * visible to Free professionals too (it shows a locked-feature preview) so
 * Premium is discoverable, rather than hidden entirely.
 */
function ProfessionalNav() {
  return <WorkspaceTabs label="Professional Workspace" tabs={tabs} />
}

export { ProfessionalNav }
