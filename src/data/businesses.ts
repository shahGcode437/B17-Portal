import type { Business } from "@/types/business"

/**
 * Demo business directory listings (Prototype Data Contract: 6–10).
 * Fictional listings, not real B-17 businesses.
 */
export const businesses: Business[] = [
  {
    id: "business-01",
    name: "B-17 Family Pharmacy",
    category: "Pharmacy",
    description: "General pharmacy and healthcare essentials.",
    area: "B-17, Block C (Demo Area)",
    image: "/images/businesses/retail-store.jpg",
    tags: ["pharmacy", "health", "medicine"],
    featured: true,
  },
  {
    id: "business-02",
    name: "Capital Cuts Salon",
    category: "Hairdressing",
    description: "Haircuts, grooming and styling services.",
    area: "B-17, Block A (Demo Area)",
    tags: ["salon", "hairdresser", "grooming"],
  },
  {
    id: "business-03",
    name: "B-17 Tailoring House",
    category: "Tailoring",
    description: "Custom stitching and alterations for men and women.",
    area: "B-17, Block D (Demo Area)",
    tags: ["tailor", "stitching", "alterations"],
  },
  {
    id: "business-04",
    name: "Fresh Mart Grocery",
    category: "Grocery",
    description: "Daily grocery and household essentials.",
    area: "B-17, Block B (Demo Area)",
    image: "/images/businesses/grocery-store.jpg",
    tags: ["grocery", "store", "essentials"],
    featured: true,
  },
  {
    id: "business-05",
    name: "B-17 Auto Care Center",
    category: "Automotive",
    description: "Vehicle servicing, repair and detailing.",
    area: "B-17, Block E (Demo Area)",
    tags: ["automotive", "car service", "repair"],
  },
  {
    id: "business-06",
    name: "Capital Bakers",
    category: "Bakery",
    description: "Fresh bread, cakes and daily bakery items.",
    area: "B-17, Block C (Demo Area)",
    image: "/images/businesses/cafe.jpg",
    tags: ["bakery", "cakes", "food"],
  },
  {
    id: "business-07",
    name: "B-17 Fitness Studio",
    category: "Fitness",
    description: "Gym, personal training and group fitness classes.",
    area: "B-17, Block A (Demo Area)",
    tags: ["fitness", "gym", "training"],
  },
]
