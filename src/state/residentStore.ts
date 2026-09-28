import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SavedItem, SavedItemKind, ServiceRequestRecord } from "@/types/resident"

interface ResidentState {
  savedItems: SavedItem[]
  requests: ServiceRequestRecord[]
  toggleSaved: (kind: SavedItemKind, id: string) => void
  addRequest: (request: ServiceRequestRecord) => void
  clearResidentData: () => void
}

/**
 * Resident-only local state (Phase 9C): saved/favorite references and this
 * resident's own service-request history. Unlike `listingsStore`/`newsStore`
 * (in-memory only, reset on reload), this one persists to `localStorage` via
 * Zustand's own `persist` middleware — already part of the installed
 * `zustand` package, no new dependency. A resident's saved list and request
 * history are the kind of state that feels broken if it vanishes on refresh,
 * so persisting them here is a deliberate, honest stand-in for the real
 * per-account backend storage this becomes once Phase 12 exists.
 *
 * Not scoped per-account: demo auth (`useAuth`) has no stable user id, only
 * a free-text name, so there is nothing real to partition this store by.
 * One browser = one demo session at a time — `AuthProvider.logout()` calls
 * `clearResidentData()` below so an explicit Log Out is the actual privacy
 * boundary (the next person to log in on this browser starts empty), while
 * an ordinary reload (which re-prompts for login but isn't a Log Out) still
 * leaves this data in place to be seen again after logging back in. See
 * `docs/development/DECISIONS.md`.
 */
export const useResidentStore = create<ResidentState>()(
  persist(
    (set) => ({
      savedItems: [],
      requests: [],

      toggleSaved: (kind, id) =>
        set((state) => {
          const exists = state.savedItems.some((item) => item.kind === kind && item.id === id)
          return {
            savedItems: exists
              ? state.savedItems.filter((item) => !(item.kind === kind && item.id === id))
              : [...state.savedItems, { kind, id, savedAt: new Date().toISOString() }],
          }
        }),

      addRequest: (request) =>
        set((state) => ({
          requests: [request, ...state.requests],
        })),

      clearResidentData: () => set({ savedItems: [], requests: [] }),
    }),
    { name: "b17-resident-store" }
  )
)

/** Whether a specific item is currently saved — shared so every card/detail page checks the same way. */
export function isItemSaved(savedItems: SavedItem[], kind: SavedItemKind, id: string): boolean {
  return savedItems.some((item) => item.kind === kind && item.id === id)
}
