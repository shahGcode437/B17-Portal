import { Armchair, Bike, ShoppingBag } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { FoodServiceOption } from "@/config/food"

/**
 * Purely visual icon per canonical service option, shared by the `/food`
 * landing page and the Food detail sections. Exhaustive on purpose: adding a
 * service option to `config/food.ts` forces an icon choice here.
 */
export const serviceIcons: Record<FoodServiceOption, LucideIcon> = {
  "dine-in": Armchair,
  takeaway: ShoppingBag,
  delivery: Bike,
}
