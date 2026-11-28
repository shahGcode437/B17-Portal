import { apiRequest } from "@/lib/api/client"
import type { GrocerySettingsDto, GrocerySettingsPatchDto } from "@/lib/api/dto/grocerySettings"

/** `PATCH /admin/grocery/settings`. Sent ONCE (the client never sends any request twice). */
export function updateGrocerySettings(patch: GrocerySettingsPatchDto, signal?: AbortSignal): Promise<GrocerySettingsDto> {
  return apiRequest<GrocerySettingsDto>("PATCH", "/admin/grocery/settings", {
    session: true,
    body: patch,
    signal,
  })
}
