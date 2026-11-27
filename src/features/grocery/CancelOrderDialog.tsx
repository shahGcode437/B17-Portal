import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormAlert } from "@/components/forms/FormAlert"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy } from "@/features/grocery/fieldStyles"
import { LIMITS } from "@/features/grocery/orderRequest"
import { useMutation } from "@/hooks/useMutation"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { cancelGroceryOrder } from "@/lib/api/writes/grocery"
import { userMessageFor } from "@/lib/api/writeErrors"
import type { ApiError } from "@/lib/api/errors"
import type { GroceryOrderDetailDto } from "@/lib/api/dto/grocery"

interface CancelOrderDialogProps {
  order: GroceryOrderDetailDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: (order: GroceryOrderDetailDto) => void
  /** The order moved on since it was shown (`409`): the page reloads it and says why. */
  onStale: (error: ApiError) => void
}

const STALE = new Set(["order_conflict", "invalid_state_transition"])

/** The customer's own cancellation: allowed by the server only, with the revision on screen. */
function CancelOrderDialog({ order, open, onOpenChange, onCancelled, onStale }: CancelOrderDialogProps) {
  const id = useId()
  const [reason, setReason] = useState("")
  const stale = useRef(false)
  const requireOnline = useRequireOnline()
  const cancel = useMutation((text: string) => cancelGroceryOrder(order.id, order.revision, text || undefined))

  async function confirm() {
    if (!requireOnline()) return
    stale.current = false
    try {
      const result = await cancel.mutate(reason.trim())
      onOpenChange(false)
      onCancelled(result)
    } catch (cause) {
      const error = cause as ApiError
      if (STALE.has(error.code)) {
        stale.current = true
        cancel.reset()
        onOpenChange(false)
        onStale(error)
      }
    }
  }

  const failure = cancel.status === "error" ? userMessageFor(cancel.error, "grocery-cancel") : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (cancel.pending) return
        if (!next) cancel.reset()
        onOpenChange(next)
      }}
    >
      {/* After a stale cancellation the page moves focus to its explanation, not back to the old button. */}
      <DialogContent onCloseAutoFocus={(event) => (stale.current ? event.preventDefault() : undefined)}>
        <DialogHeader>
          <DialogTitle>Cancel order {order.reference}?</DialogTitle>
          <DialogDescription>This can't be undone. You can send a new order afterwards.</DialogDescription>
        </DialogHeader>
        <GroceryField id={`${id}-reason`} label="Reason" optional>
          <Textarea
            id={`${id}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value.replace(/\n/g, " "))}
            maxLength={LIMITS.cancelReason}
            rows={2}
            className="min-h-20 text-base md:text-base"
            aria-describedby={describedBy(`${id}-reason`)}
          />
        </GroceryField>
        {failure && <FormAlert title={failure.title} description={failure.description} />}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={cancel.pending}>
            Keep order
          </Button>
          <Button type="button" variant="destructive" className="h-11" onClick={() => void confirm()} disabled={cancel.pending}>
            {cancel.pending ? "Cancelling…" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CancelOrderDialog }
