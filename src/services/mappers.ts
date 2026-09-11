import { Wrench, Building2, GraduationCap, KeyRound, Newspaper } from "lucide-react"
import type { SearchResult } from "@/types/search"
import type { Provider } from "@/types/provider"
import type { Business } from "@/types/business"
import type { Tutor } from "@/types/tutor"
import type { Property } from "@/types/property"
import type { NewsArticle } from "@/types/news"

/** Single-item mappers from each domain type to the normalized SearchResult shape. */

export function mapProviderToResult(p: Provider): SearchResult {
  return {
    kind: "provider",
    id: p.id,
    title: p.name,
    subtitle: p.categoryLabel,
    description: p.description,
    area: p.area,
    image: p.image,
    icon: Wrench,
    tags: p.tags,
  }
}

export function mapBusinessToResult(b: Business): SearchResult {
  return {
    kind: "business",
    id: b.id,
    title: b.name,
    subtitle: b.category,
    description: b.description,
    area: b.area,
    image: b.image,
    icon: Building2,
    tags: b.tags,
  }
}

export function mapTutorToResult(t: Tutor): SearchResult {
  return {
    kind: "tutor",
    id: t.id,
    title: t.name,
    subtitle: `${t.subject} · ${t.grade}`,
    description: t.bio,
    area: t.area,
    image: t.image,
    icon: GraduationCap,
    tags: t.tags,
  }
}

export function mapPropertyToResult(p: Property): SearchResult {
  return {
    kind: "property",
    id: p.id,
    title: p.title,
    subtitle: `${p.propertyType} · ${p.listingType === "sale" ? "For Sale" : "For Rent"}`,
    description: `${p.price}${p.bedrooms ? ` · ${p.bedrooms} bed` : ""}${p.furnished ? ` · ${p.furnished}` : ""}`,
    area: p.area,
    image: p.image,
    icon: KeyRound,
    tags: p.tags,
  }
}

export function mapNewsToResult(n: NewsArticle): SearchResult {
  return {
    kind: "news",
    id: n.id,
    title: n.title,
    subtitle: n.category,
    description: n.summary,
    image: n.image,
    icon: Newspaper,
    tags: n.tags,
  }
}
