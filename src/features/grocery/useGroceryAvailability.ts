import { useRefreshableRead } from "@/features/grocery/useRefreshableRead"
import { fetchGroceryAvailability } from "@/lib/api/reads/grocery"

/**
 * `GET /grocery/availability` (public). Nothing about opening, areas, units or limits is written in
 * the app: this answer is the only source, and the server decides again when an order is sent.
 */
export function useGroceryAvailability() {
  return useRefreshableRead("grocery-availability", (signal) => fetchGroceryAvailability(signal))
}
