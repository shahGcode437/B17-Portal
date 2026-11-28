import { apiRequest } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { GrocerySettingsDto } from "@/lib/api/dto/grocerySettings"

/** A settings answer that can't be read is a failure: nothing is guessed or filled in. */
export function checkedSettings(settings: GrocerySettingsDto | undefined): GrocerySettingsDto {
  if (
    typeof settings?.revision !== "number" ||
    typeof settings.enabled !== "boolean" ||
    !Array.isArray(settings.serviceableBlocks) ||
    !Array.isArray(settings.operatingDays)
  ) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an unexpected response." })
  }
  return settings
}

/** `GET /admin/grocery/settings` — Super Admin only. The current version; there is no history to read. */
export async function fetchGrocerySettings(signal?: AbortSignal): Promise<GrocerySettingsDto> {
  return checkedSettings(await apiRequest<GrocerySettingsDto>("GET", "/admin/grocery/settings", { signal, session: true }))
}
