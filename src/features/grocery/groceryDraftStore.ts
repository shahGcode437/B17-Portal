import { create } from "zustand"
import { submitGroceryOrder } from "@/lib/api/writes/grocery"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { EMPTY_DELIVERY, type DeliveryValues, type DraftItem, type ItemValues } from "@/features/grocery/orderRequest"
import { clearMarker, readMarker, writeMarker, type SubmissionMarker } from "@/features/grocery/submissionMarker"
import type { GroceryOrderCreateDto } from "@/lib/api/dto/grocery"
import type { AuthNotice, AuthStatus } from "@/types/auth"

/**
 * The grocery order being written, and its submission. It is CLIENT state only, held in memory:
 * never localStorage, sessionStorage or IndexedDB (it holds a name, a phone number and an address),
 * so a full page reload starts empty. No server data is kept here. The one thing stored is that a
 * send was unfinished, with nothing of the order in it (`submissionMarker`), so that after a reload
 * the customer is asked to check before sending another.
 *
 * WHOSE IT IS. A draft written while signed in belongs to that account. Signing out clears it;
 * another account signing in clears it. If the session merely ENDS (expired), it is kept but hidden
 * until the same person signs in again (`isDraftHidden`). A list written before signing in is
 * adopted by the account that signs in.
 *
 * NO DUPLICATE ORDERS. The submission lives here, not in a page, so leaving the page cannot start a
 * second one. A key is bound to the exact request body. When the outcome is UNKNOWN (no answer, a
 * timeout, a server error) the attempt is kept and the draft is LOCKED: the only automatic way
 * forward is sending the same body with the same key, which the server answers with the order it
 * already created if it had. Editing again takes an explicit `discardAttempt()`.
 */

export type SubmissionPhase = "idle" | "sending" | "unconfirmed"

export interface SubmissionProblem {
  /**
   * `refused`: the server said no and stored nothing. `unknown`: it may or may not have stored the
   * order (also after a retry that was turned away before the server could look the key up).
   */
  kind: "refused" | "unknown"
  error: ApiError
}

interface Attempt {
  key: string
  fingerprint: string
  request: GroceryOrderCreateDto
}

interface DraftState {
  ownerId: string | null
  items: DraftItem[]
  delivery: DeliveryValues
  phase: SubmissionPhase
  attempt: Attempt | null
  problem: SubmissionProblem | null
  /** The id of an order this draft just became, until the customer has seen its confirmation. */
  sentOrderId: string | null
  /** A send that a reload cut off, until its owner says they have checked their orders. */
  recovery: SubmissionMarker | null
  /** The signed-in account is known: pick up its unfinished send, if the page was reloaded. */
  loadRecovery: (userId: string) => void
  dismissRecovery: () => void
  addItem: (values: ItemValues) => void
  updateItem: (id: string, values: ItemValues) => void
  removeItem: (id: string) => void
  setDelivery: (values: DeliveryValues) => void
  /** Sends `request`; resolves to the new (or already created) order's id. Rejects with `SubmissionFailed`. */
  submit: (request: GroceryOrderCreateDto) => Promise<string>
  /** Sends the kept, unconfirmed request again with its own key. */
  retry: () => Promise<string>
  /** The customer has checked their orders and chooses to edit: forget the unconfirmed attempt. */
  discardAttempt: () => void
  clearProblem: () => void
  acknowledgeSent: () => void
  reset: () => void
}

export class SubmissionFailed extends Error {
  readonly problem: SubmissionProblem

  constructor(problem: SubmissionProblem) {
    super("The grocery order was not confirmed.")
    this.name = "SubmissionFailed"
    this.problem = problem
  }
}

/** The draft was cleared (signed out, another account) while a request was in flight: ignore its answer. */
export class SubmissionSuperseded extends Error {}

/** How long a submission waits before its outcome is treated as unknown. */
export const SUBMIT_TIMEOUT_MS = 30_000

export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // `randomUUID` needs a secure context; `getRandomValues` does not.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function unreachable(): ApiError {
  return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "No answer from the server." })
}

/**
 * What a failure proves. A refusal on a FIRST send stored nothing. On a RETRY, `400`, `401`, `403`
 * and `429` can be given before the server looks the key up, so they say nothing about the first
 * send; every refusal that comes after the lookup proves there is no order for this key.
 */
function judge(error: ApiError, retrying: boolean): SubmissionProblem {
  const noAnswer =
    error.isNetwork || error.code === "invalid_response" || (error.status >= 500 && error.code !== "grocery_unavailable")
  const beforeTheKey = retrying && [400, 401, 403, 429].includes(error.status)
  return { kind: noAnswer || beforeTheKey ? "unknown" : "refused", error }
}

let inFlight: Promise<string> | null = null
/** Bumped by `reset()`, so a late answer cannot bring back a cleared draft. */
let epoch = 0
let nextRow = 0

const CLEARED = {
  ownerId: null,
  items: [] as DraftItem[],
  delivery: EMPTY_DELIVERY,
  phase: "idle" as SubmissionPhase,
  attempt: null,
  problem: null,
  sentOrderId: null,
  recovery: null as SubmissionMarker | null,
}

export const useGroceryDraft = create<DraftState>()((set, get) => {
  /** Editing is closed while an order is being sent or its outcome is unknown. */
  const locked = () => get().phase !== "idle"

  function send(attempt: Attempt, retrying: boolean): Promise<string> {
    if (inFlight) return inFlight
    const startedIn = epoch
    set({ phase: "sending", attempt, problem: null })
    // A retry keeps the time of the FIRST send: that is when the order may have arrived.
    const owner = get().ownerId
    if (!retrying && owner) writeMarker({ owner, sentAt: Date.now() })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
    const promise = (async () => {
      try {
        const order = await submitGroceryOrder(attempt.request, attempt.key, controller.signal)
        if (typeof order?.id !== "string") {
          throw new ApiError({ status: 200, code: "invalid_response", message: "Unexpected response." })
        }
        if (startedIn !== epoch) throw new SubmissionSuperseded()
        // The order exists: the draft is finished with. (The owner stays the owner.)
        clearMarker()
        set({ ...CLEARED, ownerId: get().ownerId, sentOrderId: order.id })
        return order.id
      } catch (cause) {
        if (cause instanceof SubmissionSuperseded) throw cause
        if (startedIn !== epoch) throw new SubmissionSuperseded()
        const problem = judge(isApiError(cause) ? cause : unreachable(), retrying)
        if (problem.kind === "refused") clearMarker() // the server stored nothing
        set(
          problem.kind === "unknown"
            ? { phase: "unconfirmed", attempt, problem }
            : { phase: "idle", attempt: null, problem }
        )
        throw new SubmissionFailed(problem)
      } finally {
        clearTimeout(timer)
        if (startedIn === epoch) inFlight = null
      }
    })()
    inFlight = promise
    return promise
  }

  return {
    ...CLEARED,
    addItem: (values) => {
      if (locked()) return
      nextRow += 1
      set({ items: [...get().items, { ...values, id: `item-${nextRow}` }], problem: null, sentOrderId: null })
    },
    updateItem: (id, values) => {
      if (locked()) return
      set({ items: get().items.map((item) => (item.id === id ? { ...values, id } : item)), problem: null })
    },
    removeItem: (id) => {
      if (locked()) return
      set({ items: get().items.filter((item) => item.id !== id), problem: null })
    },
    setDelivery: (delivery) => {
      if (locked()) return
      set({ delivery })
    },
    submit: (request) => {
      if (inFlight) return inFlight
      const kept = get().attempt
      if (kept) return send(kept, true) // an unconfirmed attempt must be resolved first
      return send({ key: newIdempotencyKey(), fingerprint: JSON.stringify(request), request }, false)
    },
    retry: () => {
      if (inFlight) return inFlight
      const kept = get().attempt
      if (!kept) return Promise.reject(new SubmissionSuperseded())
      return send(kept, true)
    },
    discardAttempt: () => {
      if (get().phase !== "unconfirmed") return
      clearMarker()
      set({ phase: "idle", attempt: null, problem: null })
    },
    loadRecovery: (userId) => {
      if (get().attempt || get().phase !== "idle") return // this page still holds the attempt itself
      const marker = readMarker()
      if (marker && marker.owner !== userId) {
        clearMarker() // somebody else's: never shown, and not kept for a shared browser
        set({ recovery: null })
        return
      }
      set({ recovery: marker })
    },
    dismissRecovery: () => {
      clearMarker()
      set({ recovery: null })
    },
    clearProblem: () => {
      if (get().phase === "idle") set({ problem: null })
    },
    acknowledgeSent: () => set({ sentOrderId: null }),
    reset: () => {
      epoch += 1
      inFlight = null
      clearMarker()
      set({ ...CLEARED })
    },
  }
})

/** A draft that belongs to somebody other than the person looking is not shown to them. */
export function isDraftHidden(ownerId: string | null, viewerId: string | null): boolean {
  return ownerId !== null && ownerId !== viewerId
}

/**
 * Applies a change of the auth state to the draft. `previous` is the last DECIDED status
 * (`authenticated` or `anonymous`); `loading` and `unavailable` say nothing about who is there.
 */
export function syncDraftWithAuth(
  previous: "authenticated" | "anonymous" | null,
  status: AuthStatus,
  userId: string | null,
  notice: AuthNotice | null
): void {
  const draft = useGroceryDraft.getState()
  if (status === "authenticated" && userId) {
    if (draft.ownerId !== null && draft.ownerId !== userId) draft.reset() // another account
    useGroceryDraft.setState({ ownerId: userId })
    return
  }
  // Signed out on purpose (or the account was disabled). An EXPIRED session keeps the draft, hidden.
  if (status === "anonymous" && previous === "authenticated" && notice !== "expired") draft.reset()
}
