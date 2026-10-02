import type { SearchTypeFilter } from "@/types/search"

/** Content-type filter chips for Search/Explore (UI/UX Spec §8). */
export const searchTypeFilters: SearchTypeFilter[] = [
  { value: "all", label: "All" },
  { value: "provider", label: "Services", placeholder: "Search services" },
  { value: "business", label: "Directory", placeholder: "Search businesses" },
  { value: "tutor", label: "Education", placeholder: "Search tutors or subjects" },
  { value: "property", label: "Property", placeholder: "Search properties" },
  { value: "news", label: "News", placeholder: "Search news" },
]
