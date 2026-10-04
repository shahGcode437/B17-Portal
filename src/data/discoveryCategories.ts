import { Wrench, Building2, Utensils, GraduationCap, KeyRound, Newspaper } from "lucide-react"
import type { DiscoveryCategory } from "@/types/category"
import { routes } from "@/config/routes"

/** Quick Discovery cards on Home (Prototype Scope §7). */
export const discoveryCategories: DiscoveryCategory[] = [
  {
    label: "Services",
    description: "Construction, electrical, solar and home services",
    path: routes.services,
    icon: Wrench,
    emphasis: true,
  },
  {
    label: "Business Directory",
    description: "Local businesses and professionals",
    path: routes.directory,
    icon: Building2,
  },
  {
    label: "Food & Dining",
    description: "Restaurants, cafes, bakeries and more",
    path: routes.food,
    icon: Utensils,
  },
  {
    label: "Education",
    description: "Schools, academies and individual tutors",
    path: routes.education,
    icon: GraduationCap,
  },
  {
    label: "Property",
    description: "Houses, flats and plots for sale or rent",
    path: routes.property,
    icon: KeyRound,
  },
  {
    label: "News & Updates",
    description: "Local news and daily community updates",
    path: routes.news,
    icon: Newspaper,
  },
]
