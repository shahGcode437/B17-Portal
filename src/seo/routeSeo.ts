import { matchPath } from "react-router-dom"
import { routes } from "@/config/routes"
import { HOME_TITLE, SITE_DESCRIPTION, pageTitle } from "@/config/seo"
import type { Indexing, SeoDescriptor } from "@/seo/seoState"

/**
 * Metadata for every route, in one table (Phase 9J). Public discovery routes are indexable with
 * their own canonical; account / workspace / admin / utility routes are `noindex, nofollow`
 * (they still get a real title — a page title per route is also an accessibility requirement).
 * Detail routes get a neutral default here; the page overrides it with the actual entity once
 * it is loaded (see `useSeo`). `/search` is deliberately NOT indexable: its `?q=` / `type` /
 * `vertical` / filter URLs are an effectively unlimited set of thin result pages, so it is
 * `noindex, follow` with the canonical pointing at the stable `/search`; discovery happens
 * through the indexable landing pages (`/food`, `/directory`, …) and the detail pages.
 */
const PRIVATE: Indexing = "noindex,nofollow"

function publicPage(title: string, description: string, canonicalPath: string): SeoDescriptor {
  return { title, description, indexing: "index", canonicalPath, ogType: "website" }
}

function privatePage(title: string, description = SITE_DESCRIPTION): SeoDescriptor {
  return { title: pageTitle(title), description, indexing: PRIVATE }
}

interface RouteEntry {
  path: string
  seo: SeoDescriptor
}

// First match wins, so specific paths come before their prefixes.
const entries: RouteEntry[] = [
  { path: routes.home, seo: publicPage(HOME_TITLE, SITE_DESCRIPTION, "/") },
  {
    path: routes.search,
    seo: {
      title: pageTitle("Search B-17"),
      description: "Search services, businesses, food, tutors, property and news in B-17, Islamabad.",
      indexing: "noindex,follow",
      canonicalPath: routes.search,
    },
  },
  {
    path: routes.services,
    seo: publicPage(pageTitle("Home & Construction Services in B-17"), "Browse home and construction service providers in B-17, Islamabad, and contact them directly.", routes.services),
  },
  {
    path: routes.providerProfile,
    seo: { title: pageTitle("Service Provider"), description: "A service provider in B-17, Islamabad.", indexing: "index", ogType: "website" },
  },
  {
    path: routes.directory,
    seo: publicPage(pageTitle("Businesses in B-17"), "Find local shops, pharmacies, salons and other businesses in B-17, Islamabad.", routes.directory),
  },
  {
    path: routes.food,
    seo: publicPage(pageTitle("Food & Dining in B-17"), "Restaurants, cafes, bakeries and more in B-17, Islamabad. Browse by category or service, then contact the business directly.", routes.food),
  },
  {
    path: routes.businessProfile,
    seo: { title: pageTitle("Business"), description: "A local business in B-17, Islamabad.", indexing: "index", ogType: "website" },
  },
  {
    path: routes.education,
    seo: publicPage(pageTitle("Education & Tutors in B-17"), "Find tutors and education services by subject and level in B-17, Islamabad.", routes.education),
  },
  {
    path: routes.tutorProfile,
    seo: { title: pageTitle("Tutor"), description: "A tutor in B-17, Islamabad.", indexing: "index", ogType: "website" },
  },
  {
    path: routes.property,
    seo: publicPage(pageTitle("Property in B-17"), "Houses, flats and plots for sale or rent in B-17, Islamabad.", routes.property),
  },
  {
    path: routes.propertyDetails,
    seo: { title: pageTitle("Property"), description: "A property listing in B-17, Islamabad.", indexing: "index", ogType: "website" },
  },
  {
    path: routes.news,
    seo: publicPage(pageTitle("B-17 News & Updates"), "Local news and daily updates for B-17, Islamabad.", routes.news),
  },
  {
    path: routes.newsArticle,
    seo: { title: pageTitle("News"), description: "A local news item for B-17, Islamabad.", indexing: "index", ogType: "article" },
  },

  { path: routes.login, seo: privatePage("Log In") },
  { path: routes.register, seo: privatePage("Create Account") },
  { path: routes.forgotPassword, seo: privatePage("Forgot Password") },
  { path: routes.verifyEmail, seo: privatePage("Verify Email") },
  { path: routes.resetPassword, seo: privatePage("Reset Password") },
  { path: routes.profileSaved, seo: privatePage("Saved") },
  { path: routes.profileRequests, seo: privatePage("My Requests") },
  { path: routes.profile, seo: privatePage("My Profile") },
  { path: routes.comingSoon, seo: privatePage("Coming Soon") },

  { path: routes.createListing, seo: privatePage("New Listing") },
  { path: routes.listingPending, seo: privatePage("Listing Submitted") },
  { path: routes.editListing, seo: privatePage("Edit Listing") },
  { path: routes.providerListings, seo: privatePage("My Listings") },
  { path: routes.providerLeads, seo: privatePage("Leads") },
  { path: routes.professionalProfile, seo: privatePage("Professional Profile") },
  { path: routes.providerAnalytics, seo: privatePage("Analytics") },
  { path: routes.providerUpgrade, seo: privatePage("Free & Premium") },
  { path: routes.providerDashboard, seo: privatePage("Professional Overview") },

  { path: routes.adminLogin, seo: privatePage("Admin Login") },
  { path: routes.adminModeration, seo: privatePage("Listing Review") },
  { path: routes.adminContentNew, seo: privatePage("Create Content") },
  { path: routes.adminContentEdit, seo: privatePage("Edit Content") },
  { path: routes.adminContent, seo: privatePage("News & Updates (Admin)") },
  { path: routes.adminDashboard, seo: privatePage("Admin Dashboard") },
]

/** A URL no route matches: a real 404 must never be indexed. */
const notFound: SeoDescriptor = {
  title: pageTitle("Page Not Found"),
  description: "The page you're looking for doesn't exist or may have been moved.",
  indexing: PRIVATE,
}

export function resolveRouteSeo(pathname: string): SeoDescriptor {
  const found = entries.find((entry) => matchPath({ path: entry.path, end: true }, pathname))
  return found ? found.seo : notFound
}
