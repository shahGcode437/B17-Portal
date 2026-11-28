import { useReportRefusedRead, useVerifiedReload } from "@/hooks/useVerifiedReload"
import { isLostAccess } from "@/features/grocery-staff/staffErrors"
import { canWorkGroceryOrders } from "@/lib/staffAccess"
import type { ApiError } from "@/lib/api/errors"
import type { CurrentUser } from "@/types/auth"

/** The grocery staff screens' refresh: identity first (see `useVerifiedReload`). */
export function useStaffReload(user: CurrentUser, reload: () => void) {
  return useVerifiedReload(user, reload, canWorkGroceryOrders)
}

export function useReportLostAccess(error: ApiError | null) {
  useReportRefusedRead(error, isLostAccess)
}
