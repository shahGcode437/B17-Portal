import {
  Atom,
  BookOpen,
  Building2,
  Calculator,
  Car,
  Compass,
  Dumbbell,
  Fence,
  FlaskConical,
  GraduationCap,
  HardHat,
  Hammer,
  Layers,
  PaintRoller,
  Pill,
  Scissors,
  Shirt,
  ShoppingBasket,
  Sofa,
  Sun,
  Warehouse,
  Wrench,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * Icons for category tiles (Phase 12G) - PURELY VISUAL presentation keyed by the category SLUG.
 * The list of categories, their names and their order come from `GET /categories`; this table only
 * decorates the ones it knows. A category an admin adds later (Phase 12E) gets the module's fallback
 * icon until someone picks a better one - no code change is needed for it to appear.
 */
const SERVICE_ICONS: Record<string, LucideIcon> = {
  construction: HardHat,
  electrical: Zap,
  solar: Sun,
  architecture: Compass,
  painting: PaintRoller,
  plumbing: Wrench,
  "interior-design": Sofa,
  renovation: Hammer,
  finishing: Layers,
  aluminium: Fence,
  hardware: Warehouse,
}

const DIRECTORY_ICONS: Record<string, LucideIcon> = {
  pharmacy: Pill,
  hairdressing: Scissors,
  tailoring: Shirt,
  grocery: ShoppingBasket,
  automotive: Car,
  fitness: Dumbbell,
}

const EDUCATION_ICONS: Record<string, LucideIcon> = {
  physics: Atom,
  mathematics: Calculator,
  english: BookOpen,
  chemistry: FlaskConical,
}

export const serviceIconFor = (slug: string): LucideIcon => SERVICE_ICONS[slug] ?? Wrench
export const directoryIconFor = (slug: string): LucideIcon => DIRECTORY_ICONS[slug] ?? Building2
export const educationIconFor = (slug: string): LucideIcon => EDUCATION_ICONS[slug] ?? GraduationCap
