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
  newsArticle: "/news/:id",

  login: "/login",
  register: "/register",
  profile: "/profile",

  providerProfile: "/providers/:id",

  providerDashboard: "/provider",
  createListing: "/provider/listings/new",
  listingPending: "/provider/listings/pending",

  adminLogin: "/admin/login",
  adminDashboard: "/admin",
  adminModeration: "/admin/moderation",

  comingSoon: "/coming-soon",
} as const

export type AppRoute = (typeof routes)[keyof typeof routes]

/** Builds a concrete link to a provider's public profile (e.g. "/providers/provider-solar-01"). */
export function providerProfilePath(id: string): string {
  return `/providers/${id}`
}

/** Builds a concrete link to a news article/update detail page (e.g. "/news/news-01"). */
export function newsArticlePath(id: string): string {
  return `/news/${id}`
}
