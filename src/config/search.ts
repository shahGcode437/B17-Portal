import type { SearchTypeFilter } from "@/types/search"

/** Content-type filter chips for Search/Explore (UI/UX Spec §8). */
export const searchTypeFilters: SearchTypeFilter[] = [
  { value: "all", label: "All" },
  { value: "provider", label: "Services" },
  { value: "business", label: "Directory" },
  { value: "tutor", label: "Education" },
  { value: "property", label: "Property" },
  { value: "news", label: "News" },
]
