import type { Provider } from "@/types/provider"

/**
 * Demo construction/home-service providers (Prototype Data Contract: 8–12).
 * Fictional listings — not real B-17 businesses. Names, areas and contact
 * details are generic placeholders, never real phone numbers or addresses.
 */
export const providers: Provider[] = [
  {
    id: "provider-construction-01",
    name: "B-17 Construction Co.",
    category: "construction",
    categoryLabel: "Construction",
    description: "General contracting for new builds, extensions and structural work.",
    area: "B-17, Block C (Demo Area)",
    image: "/images/providers/construction-provider.jpg",
    tags: ["construction", "contractor", "structural", "new build"],
    featured: true,
  },
  {
    id: "provider-electrical-01",
    name: "Highland Electrical Services",
    category: "electrical",
    categoryLabel: "Electrical",
    description: "Residential wiring, fault-finding and fixture installation.",
    area: "B-17, Block A (Demo Area)",
    image: "/images/providers/electrician-provider.jpg",
    tags: ["electrician", "wiring", "electrical", "fixtures"],
    featured: true,
  },
  {
    id: "provider-solar-01",
    name: "Sunrise Solar Solutions",
    category: "solar",
    categoryLabel: "Solarization",
    description: "Rooftop solar panel installation and net-metering setup.",
    area: "B-17, Block D (Demo Area)",
    image: "/images/providers/solar-provider.jpg",
    tags: ["solar", "solar panel", "net metering", "renewable"],
    featured: true,
  },
  {
    id: "provider-architecture-01",
    name: "B-17 Architecture Studio",
    category: "architecture",
    categoryLabel: "Architecture",
    description: "Residential design, structural drawings and approvals support.",
    area: "B-17, Block B (Demo Area)",
    image: "/images/providers/architect-provider.jpg",
    tags: ["architect", "design", "drawings", "planning"],
  },
  {
    id: "provider-painting-01",
    name: "Capital Painters",
    category: "painting",
    categoryLabel: "Painting",
    description: "Interior and exterior painting with texture and finish options.",
    area: "B-17, Block C (Demo Area)",
    // No dedicated painter-provider photo supplied — falls back to the
    // category photo from public/images/services/.
    image: "/images/services/painting.jpg",
    tags: ["painting", "texture", "interior", "exterior"],
  },
  {
    id: "provider-plumbing-01",
    name: "Precision Plumbing",
    category: "plumbing",
    categoryLabel: "Plumbing",
    description: "Leak repair, fittings and full bathroom/kitchen plumbing.",
    area: "B-17, Block A (Demo Area)",
    image: "/images/providers/plumber-provider.jpg",
    tags: ["plumber", "plumbing", "leak repair", "fittings"],
    featured: true,
  },
  {
    id: "provider-interior-01",
    name: "B-17 Interiors Studio",
    category: "interior-design",
    categoryLabel: "Interior Design",
    description: "Space planning, false ceiling and custom furniture concepts.",
    area: "B-17, Block E (Demo Area)",
    image: "/images/providers/interior-designer-provider.jpg",
    tags: ["interior design", "false ceiling", "furniture", "space planning"],
  },
  {
    id: "provider-renovation-01",
    name: "Renew Renovation Works",
    category: "renovation",
    categoryLabel: "Renovation",
    description: "Full-home renovation and remodeling for older properties.",
    area: "B-17, Block D (Demo Area)",
    image: "/images/providers/renovation-provider.jpg",
    tags: ["renovation", "remodeling", "home upgrade"],
  },
  {
    id: "provider-finishing-01",
    name: "Finesse Finishing Services",
    category: "finishing",
    categoryLabel: "Finishing",
    description: "Tiling, flooring, POP and final-stage finishing work.",
    area: "B-17, Block B (Demo Area)",
    // No dedicated provider photo — category photo fallback.
    image: "/images/services/finishing.jpg",
    tags: ["finishing", "tiling", "flooring", "pop"],
  },
  {
    id: "provider-aluminium-01",
    name: "B-17 Aluminium & Glass Works",
    category: "aluminium",
    categoryLabel: "Aluminium",
    description: "Aluminium windows, doors and glass partition installation.",
    area: "B-17, Block C (Demo Area)",
    // No dedicated provider photo — category photo fallback.
    image: "/images/services/aluminium.jpg",
    tags: ["aluminium", "glass", "windows", "doors"],
  },
  {
    id: "provider-hardware-01",
    name: "Capital Hardware Supplies",
    category: "hardware",
    categoryLabel: "Hardware",
    description: "Construction hardware, tools and fittings for local projects.",
    area: "B-17, Block A (Demo Area)",
    // No dedicated provider photo — category photo fallback.
    image: "/images/services/hardware.jpg",
    tags: ["hardware", "tools", "supplies", "fittings"],
  },
]
