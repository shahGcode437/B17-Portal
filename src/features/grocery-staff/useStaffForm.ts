import { useState } from "react"
import type { StaffSend, StaffWriteResult } from "@/features/grocery-staff/useStaffOrderWrite"
import type { ApiError } from "@/lib/api/errors"
import type { GroceryStaffActionDto, GroceryStaffOrderDetailDto } from "@/lib/api/dto/groceryStaff"

/** What every staff action form is given. */
export interface StaffFormProps {
  order: GroceryStaffOrderDetailDto
  pending: boolean
  run: (action: GroceryStaffActionDto, send: StaffSend) => Promise<StaffWriteResult | null>
  onClose: () => void
  /** True when the page is about to explain what happened, so focus must not jump back to the old button. */
  pageExplains: () => boolean
}

/**
 * The revision the person was looking at when the form opened, and the refusal (if any) that keeps it
 * open. A form must never act on an order that changed underneath it, so `outdated` blocks sending.
 */
export function useStaffForm(action: GroceryStaffActionDto, { order, run }: StaffFormProps) {
  const [revision] = useState(order.revision)
  const [refusal, setRefusal] = useState<{ error: ApiError } | null>(null)
  // An issue carries no revision: it can be recorded against the order whatever has happened to it.
  const outdated =
    !order.availableActions.includes(action) || (action !== "record_issue" && order.revision !== revision)

  async function submit(send: StaffSend) {
    setRefusal(null)
    const result = await run(action, send)
    if (result && "kept" in result) setRefusal({ error: result.kept })
  }

  return { revision, refusal, outdated, submit }
}
