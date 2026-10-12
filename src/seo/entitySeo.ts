import { businessProfilePath, newsArticlePath, propertyDetailsPath, providerProfilePath, tutorProfilePath } from "@/config/routes"
import { SITE_DESCRIPTION, pageTitle, publicImagePath, summarize } from "@/config/seo"
import type { SeoDescriptor } from "@/seo/seoState"
import type { Business } from "@/types/business"
import type { NewsArticle } from "@/types/news"
import type { Property } from "@/types/property"
import type { Provider } from "@/types/provider"
import type { Tutor } from "@/types/tutor"

/**
 * SEO descriptors for the public detail pages (Phase 9J), derived only from fields the page
 * already shows to every visitor — no contact data, internal ids beyond the canonical URL, or
 * submitter information. Missing fields fall back gracefully; an entity that does not exist
 * is `noindex` (its page is a "not found" state).
 */
function missing(what: string): SeoDescriptor {
  return { title: pageTitle(`${what} not found`), description: SITE_DESCRIPTION, indexing: "noindex,nofollow" }
}

export function providerSeo(provider: Provider | undefined): SeoDescriptor {
  if (!provider) return missing("Service provider")
  return {
    title: pageTitle(provider.name),
    description: summarize(`${provider.categoryLabel} in ${provider.area}. ${provider.description}`, `${provider.categoryLabel} in B-17, Islamabad.`),
    indexing: "index",
    canonicalPath: providerProfilePath(provider.id),
    image: publicImagePath(provider.image),
    ogType: "website",
  }
}

export function businessSeo(business: Business | undefined): SeoDescriptor {
  if (!business) return missing("Business")
  return {
    title: pageTitle(business.name),
    description: summarize(`${business.category} in ${business.area}. ${business.description}`, `${business.category} in B-17, Islamabad.`),
    indexing: "index",
    canonicalPath: businessProfilePath(business.id),
    image: publicImagePath(business.image),
    ogType: "website",
  }
}

export function tutorSeo(tutor: Tutor | undefined): SeoDescriptor {
  if (!tutor) return missing("Tutor")
  return {
    title: pageTitle(tutor.name),
    description: summarize(`${tutor.subject} tutor (${tutor.grade}) in ${tutor.area}. ${tutor.bio}`, `${tutor.subject} tutor in B-17, Islamabad.`),
    indexing: "index",
    canonicalPath: tutorProfilePath(tutor.id),
    image: publicImagePath(tutor.image),
    ogType: "website",
  }
}

export function propertySeo(property: Property | undefined): SeoDescriptor {
  if (!property) return missing("Property")
  const forWhat = property.listingType === "sale" ? "for sale" : "for rent"
  return {
    title: pageTitle(property.title),
    description: summarize(`${property.propertyType} ${forWhat} in ${property.area}. ${property.description ?? ""}`, `${property.propertyType} ${forWhat} in B-17, Islamabad.`),
    indexing: "index",
    canonicalPath: propertyDetailsPath(property.id),
    image: publicImagePath(property.image),
    ogType: "website",
  }
}

export function newsSeo(article: NewsArticle | undefined): SeoDescriptor {
  if (!article) return missing("News item")
  return {
    title: pageTitle(article.title),
    description: summarize(article.summary, "Local news and updates for B-17, Islamabad."),
    indexing: "index",
    canonicalPath: newsArticlePath(article.id),
    image: publicImagePath(article.image),
    ogType: "article",
  }
}
