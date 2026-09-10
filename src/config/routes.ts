/**
 * Centralized route definitions (Master Spec §15). Screens must reference
 * these constants instead of hard-coding path strings.
 */
export const routes = {
  home: "/",
  search: "/search",
  services: "/services",
  servicesConstruction: "/services/home-construction",
  directory: "/directory",
  education: "/education",
  property: "/property",
  news: "/news",

  login: "/login",
  register: "/register",
  profile: "/profile",

  providerDashboard: "/provider",
  createListing: "/provider/listings/new",
  listingPending: "/provider/listings/pending",

  adminLogin: "/admin/login",
  adminDashboard: "/admin",
  adminModeration: "/admin/moderation",

  comingSoon: "/coming-soon",
} as const

export type AppRoute = (typeof routes)[keyof typeof routes]
