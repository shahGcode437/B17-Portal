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
  profileSaved: "/profile/saved",
  profileRequests: "/profile/requests",

  providerProfile: "/providers/:id",
  businessProfile: "/businesses/:id",
  tutorProfile: "/tutors/:id",
  propertyDetails: "/properties/:id",

  providerDashboard: "/provider",
  createListing: "/provider/listings/new",
  listingPending: "/provider/listings/pending",

  adminLogin: "/admin/login",
  adminDashboard: "/admin",
  adminModeration: "/admin/moderation",
  adminContent: "/admin/content",
  adminContentNew: "/admin/content/new",
  adminContentEdit: "/admin/content/:id/edit",

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

/** Builds a concrete link to a business's public profile (e.g. "/businesses/business-01"). */
export function businessProfilePath(id: string): string {
  return `/businesses/${id}`
}

/** Builds a concrete link to a tutor's public profile (e.g. "/tutors/tutor-physics-01"). */
export function tutorProfilePath(id: string): string {
  return `/tutors/${id}`
}

/** Builds a concrete link to a property's details page (e.g. "/properties/property-01"). */
export function propertyDetailsPath(id: string): string {
  return `/properties/${id}`
}

/** Builds a concrete link to the Admin edit form for a news item (e.g. "/admin/content/news-01/edit"). */
export function adminContentEditPath(id: string): string {
  return `/admin/content/${id}/edit`
}
