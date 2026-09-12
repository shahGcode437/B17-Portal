import type { NewsArticle } from "@/types/news"

/**
 * Seed news articles and daily updates (Prototype Data Contract: 3–5 each).
 * Consumed by useNewsStore as its initial state. Fictional prototype content.
 */
export const newsSeed: NewsArticle[] = [
  {
    id: "news-01",
    kind: "news",
    status: "published",
    title: "B-17 Community Park Cleanup Drive This Weekend",
    category: "Community",
    summary:
      "Residents are invited to join a local cleanup drive at the B-17 community park, organized as part of an ongoing neighborhood initiative.",
    publishedAt: "2026-09-05",
    image: "/images/news/community.jpg",
    tags: ["community", "event", "cleanup"],
  },
  {
    id: "news-02",
    kind: "update",
    status: "published",
    title: "Scheduled Water Supply Maintenance — Block C",
    category: "Utilities",
    summary:
      "Water supply maintenance is scheduled in Block C. Residents should expect a temporary interruption during the maintenance window.",
    publishedAt: "2026-09-08",
    image: "/images/news/water.jpg",
    tags: ["water", "utilities", "maintenance"],
  },
  {
    id: "news-03",
    kind: "update",
    status: "published",
    title: "Road Resurfacing Update — Main Boulevard",
    category: "Infrastructure",
    summary:
      "Resurfacing work continues along the main boulevard. Alternate routes are recommended during peak hours.",
    publishedAt: "2026-09-07",
    image: "/images/news/roads.jpg",
    tags: ["roads", "infrastructure"],
  },
  {
    id: "news-04",
    kind: "news",
    status: "published",
    title: "New Local Market Stalls Open in B-17",
    category: "Local Business",
    summary:
      "Several new stalls have opened at the local B-17 market, adding more everyday shopping options for residents.",
    publishedAt: "2026-09-06",
    image: "/images/news/announcement.jpg",
    tags: ["local business", "market"],
  },
  {
    id: "news-05",
    kind: "update",
    status: "published",
    title: "Evening Power Load Management Notice",
    category: "Utilities",
    summary:
      "A short evening load management window has been announced for parts of B-17. Details are being shared by area representatives.",
    publishedAt: "2026-09-09",
    image: "/images/news/electricity.jpg",
    tags: ["electricity", "utilities"],
  },
]
