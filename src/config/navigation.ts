import {
  Home,
  Compass,
  Wrench,
  Building2,
  GraduationCap,
  KeyRound,
  Newspaper,
  User,
  PlusCircle,
} from "lucide-react"
import type { NavItem } from "@/types/navigation"
import { routes } from "@/config/routes"

/** Desktop navigation (UI/UX Spec §6): Home → Services → Directory → Education → Property → News → Profile */
export const desktopNav: NavItem[] = [
  { label: "Services", path: routes.services, icon: Wrench },
  { label: "Directory", path: routes.directory, icon: Building2 },
  { label: "Education", path: routes.education, icon: GraduationCap },
  { label: "Property", path: routes.property, icon: KeyRound },
  { label: "News & Updates", path: routes.news, icon: Newspaper },
]

/** Mobile bottom navigation (UI/UX Spec §6): condensed, does not mirror desktop 1:1 */
export const mobileNav: NavItem[] = [
  { label: "Home", path: routes.home, icon: Home },
  { label: "Explore", path: routes.search, icon: Compass },
  { label: "Request", path: routes.services, icon: PlusCircle },
  { label: "Updates", path: routes.news, icon: Newspaper },
  { label: "Profile", path: routes.profile, icon: User },
]

export const footerNav: NavItem[] = [
  { label: "Services", path: routes.services },
  { label: "Business Directory", path: routes.directory },
  { label: "Education", path: routes.education },
  { label: "Property", path: routes.property },
  { label: "News & Daily Updates", path: routes.news },
]

export const footerFutureModules: NavItem[] = [
  { label: "Marketplace", path: routes.comingSoon, future: true },
  { label: "Pharmacy", path: routes.comingSoon, future: true },
  { label: "Pick & Drop", path: routes.comingSoon, future: true },
  { label: "Community", path: routes.comingSoon, future: true },
  { label: "B-17 Vault", path: routes.comingSoon, future: true },
]
