import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { useToast } from "@/hooks/useToast"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { getIdentityStamp } from "@/lib/api/session"
import { ACTION_DONE, ACTION_NOUN } from "@/features/grocery-staff/staffLabels"
import { isLostAccess, isOwnOrder, isStaleOrder, isUnknownOutcome, needsSuperAdmin, staffRefusalCopy } from "@/features/grocery-staff/staffErrors"
import { acquireWrite, releaseWrite, useWriteInFlight } from "@/hooks/useWriteLock"
import type { GroceryStaffActionDto, GroceryStaffOrderDetailDto } from "@/lib/api/dto/groceryStaff"

export const STAFF_WRITE_TIMEOUT_MS = 30_000

export type StaffSend = (signal: AbortSignal) => Promise<GroceryStaffOrderDetailDto>

export interface StaffNotice {
  title: string
  description: string
}

/** `kept`: the refusal belongs to the form, which stays open. `closed`: the page now explains. */
export type StaffWriteResult = { kept: ApiError } | { closed: true }

interface Options {
  userId: string
  orderId: string
  /** The order as currently shown. */
  order: GroceryStaffOrderDetailDto | undefined
  replace: (order: GroceryStaffOrderDetailDto) => void
  reload: () => void
  closeDialog: () => void
}

/**
 * How every staff change is made:
 *  - one at a time per order, sent exactly once, with a time limit;
 *  - nothing on screen changes until the server has answered with the order as it now is;
 *  - after a success or a conflict the order is loaded again from the server;
 *  - when the outcome is UNKNOWN nothing is retried, and no action is offered until a fresh copy of
 *    the order has arrived;
 *  - whatever arrives after the signed-in account changed does nothing here.
 */
export function useStaffOrderWrite({ userId, orderId, order, replace, reload, closeDialog }: Options) {
  const { refreshMe } = useAuth()
  const { show } = useToast()
  const requireOnline = useRequireOnline()
  const key = `${userId}:${orderId}`
  const pending = useWriteInFlight(key)
  const [notice, setNotice] = useState<StaffNotice | null>(null)
  const [unknown, setUnknown] = useState<{ action: GroceryStaffActionDto; before: GroceryStaffOrderDetailDto } | null>(null)
  const startedHere = useRef(false)
  // Set before a dialog closes, so it knows whether focus goes to the page's explanation instead.
  const explaining = useRef(false)

  // A change that finished after this screen was left and reopened: load what it did.
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) {
      // This screen's own changes already load the order again where they need to.
      if (startedHere.current) startedHere.current = false
      else reload()
    }
    wasPending.current = pending
  }, [pending, reload])

  const run = useCallback(
    async (action: GroceryStaffActionDto, send: StaffSend): Promise<StaffWriteResult | null> => {
      if (!order || !requireOnline() || !acquireWrite(key)) return null
      startedHere.current = true
      explaining.current = false
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), STAFF_WRITE_TIMEOUT_MS)
      const askedAs = getIdentityStamp()
      try {
        const updated = await send(controller.signal)
        if (getIdentityStamp() !== askedAs) return { closed: true }
        if (updated?.id !== orderId || !Array.isArray(updated.availableActions)) {
          throw new ApiError({ status: 200, code: "invalid_response", message: "Unexpected response." })
        }
        setNotice(null)
        setUnknown(null)
        closeDialog()
        replace(updated)
        reload()
        show(ACTION_DONE[action])
        return { closed: true }
      } catch (cause) {
        if (getIdentityStamp() !== askedAs) return { closed: true }
        const error = isApiError(cause)
          ? cause
          : new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "No answer." })
        // The auth layer ends the session and the access gate takes the screen away.
        if (error.status === 401 || error.code === "account_disabled") return { closed: true }
        if (isUnknownOutcome(error)) {
          explaining.current = true
          setNotice(null)
          setUnknown({ action, before: order })
          closeDialog()
          reload()
          return { closed: true }
        }
        if (isStaleOrder(error) || isOwnOrder(error) || needsSuperAdmin(error) || isLostAccess(error) || error.status === 404) {
          explaining.current = true
          setUnknown(null)
          setNotice(staffRefusalCopy(error))
          closeDialog()
          if (needsSuperAdmin(error) || isLostAccess(error)) void refreshMe({ fresh: true })
          reload()
          return { closed: true }
        }
        return { kept: error }
      } finally {
        clearTimeout(timer)
        releaseWrite(key)
      }
    },
    [order, requireOnline, key, orderId, closeDialog, replace, reload, show, refreshMe]
  )

  // Until a copy newer than the one we acted on arrives, we don't know where the order stands.
  const locked = unknown !== null && order === unknown.before
  const unknownNotice: StaffNotice | null =
    unknown === null
      ? null
      : locked
        ? {
            title: `We don't know whether ${ACTION_NOUN[unknown.action]} was saved`,
            description: "Nothing was sent again. Actions are paused until the order has been loaded again.",
          }
        : {
            title: `Check whether ${ACTION_NOUN[unknown.action]} was saved`,
            description:
              "We got no clear answer, and nothing was sent again. The order has been reloaded: check it below before you do this again. A request that was slow could still arrive.",
          }

  /** Read at the moment a dialog closes (a render may not have happened in between). */
  const pageExplains = useCallback(() => explaining.current, [])

  return { run, pending, locked, notice: unknownNotice ?? notice, pageExplains }
}
