import {
  HardHat,
  Zap,
  Sun,
  Compass,
  PaintRoller,
  Wrench,
  Sofa,
  Hammer,
  Layers,
  Fence,
  Warehouse,
} from "lucide-react"
import type { ServiceCategory } from "@/types/category"

/**
 * Home & Construction service categories (Project Overview §4, Prototype
 * Scope §8). Construction/home services are the initial supply focus.
 */
export const serviceCategories: ServiceCategory[] = [
  { slug: "construction", label: "Construction", icon: HardHat },
  { slug: "electrical", label: "Electrical", icon: Zap },
  { slug: "solar", label: "Solar", icon: Sun },
  { slug: "architecture", label: "Architecture", icon: Compass },
  { slug: "painting", label: "Painting", icon: PaintRoller },
  { slug: "plumbing", label: "Plumbing", icon: Wrench },
  { slug: "interior-design", label: "Interior Design", icon: Sofa },
  { slug: "renovation", label: "Renovation", icon: Hammer },
  { slug: "finishing", label: "Finishing", icon: Layers },
  { slug: "aluminium", label: "Aluminium", icon: Fence },
  { slug: "hardware", label: "Hardware", icon: Warehouse },
]
