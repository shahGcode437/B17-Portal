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
  // A server from before §21 sends neither: cash only, and no all-of-B-17 claim.
  return {
    ...settings,
    paymentMethods: settings.paymentMethods ?? ["cash_on_delivery"],
    coversAllB17: settings.coversAllB17 ?? false,
  }
}

/** `GET /admin/grocery/settings` — Super Admin only. The current version; there is no history to read. */
export async function fetchGrocerySettings(signal?: AbortSignal): Promise<GrocerySettingsDto> {
  return checkedSettings(await apiRequest<GrocerySettingsDto>("GET", "/admin/grocery/settings", { signal, session: true }))
}
