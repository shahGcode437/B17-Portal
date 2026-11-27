import { useState } from "react"
import { Link } from "react-router-dom"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormAlert } from "@/components/forms/FormAlert"
import { friendlyFieldErrors, userMessageFor } from "@/lib/api/writeErrors"
import { routes } from "@/config/routes"
import type { SubmissionProblem } from "@/features/grocery/groceryDraftStore"

const linkClass = "font-medium text-primary underline underline-offset-4"

/** The server said no and stored nothing: why, and where to fix it. */
function RefusedAlert({ problem }: { problem: SubmissionProblem }) {
  const { error } = problem
  const copy = userMessageFor(error, "grocery-submit")
  const fields = Object.keys(friendlyFieldErrors(error))
  const sentences = [...new Set(Object.values(friendlyFieldErrors(error)))].filter((text) => text !== copy.description)
  const inList = fields.some((field) => field.startsWith("items"))
  const inDelivery = fields.some((field) => field.startsWith("delivery") || field === "instructions")
  const toOrders = error.code === "grocery_active_order_limit" || error.code === "idempotency_key_reused"
  const hasAction = sentences.length > 0 || inList || inDelivery || toOrders
  return (
    <FormAlert
      title={copy.title}
      description={copy.description}
      action={
        hasAction ? (
          <span className="flex flex-col gap-1">
            {sentences.map((sentence) => (
              <span key={sentence}>{sentence}</span>
            ))}
            <span className="flex flex-wrap gap-x-4">
              {inList && (
                <Link to={routes.groceryNew} className={linkClass}>
                  Edit your list
                </Link>
              )}
              {inDelivery && (
                <Link to={routes.groceryDelivery} className={linkClass}>
                  Edit delivery details
                </Link>
              )}
              {toOrders && (
                <Link to={routes.profileGrocery} className={linkClass}>
                  See My Grocery Orders
                </Link>
              )}
            </span>
          </span>
        ) : undefined
      }
    />
  )
}

/** Why the outcome is still unknown, in words that say what to do next. */
function unknownReason(problem: SubmissionProblem | null): string {
  const error = problem?.error
  if (error?.status === 401) return "Your session ended before we could check. Sign in with the same account, then send it again."
  if (error?.code === "email_not_verified") return "Verify your email address, then send it again."
  if (error?.status === 429) return "There were too many attempts. Wait a while, then send it again."
  if (error?.status === 403 || error?.status === 400) return "We couldn't check it just now. Try sending it again."
  return "We didn't get a clear answer, so your order may or may not have reached us."
}

interface UnconfirmedPanelProps {
  problem: SubmissionProblem | null
  sending: boolean
  onRetry: () => void
  onDiscard: () => void
}

/**
 * The outcome of a submission is unknown. The one safe step is to send the SAME order again: it
 * carries the same key, so the server answers with the order it already has rather than creating a
 * second one. Editing instead is possible only after the customer says they have checked.
 */
function UnconfirmedPanel({ problem, sending, onRetry, onDiscard }: UnconfirmedPanelProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <section
      role="alert"
      aria-labelledby="grocery-unconfirmed"
      className="flex flex-col gap-4 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/40 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <Typography as="h2" id="grocery-unconfirmed" variant="label" className="text-base font-semibold">
            We couldn't confirm your order
          </Typography>
          <Typography variant="body-sm">{unknownReason(problem)}</Typography>
          <Typography variant="body-sm">
            Sending it again is safe: it can't create a second order. Keep this tab open until it's confirmed.
          </Typography>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" className="h-11" onClick={onRetry} disabled={sending}>
          <RefreshCw />
          Send the same order again
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to={routes.profileGrocery}>Check My Grocery Orders</Link>
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirming(true)} disabled={sending}>
          Edit my order instead
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit instead of resending?</DialogTitle>
            <DialogDescription>
              Check My Grocery Orders first. If your first order did arrive and you send a changed one, you'll have two
              orders.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfirming(false)}>
              Keep it unchanged
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => {
                setConfirming(false)
                onDiscard()
              }}
            >
              I've checked: let me edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export { RefusedAlert, UnconfirmedPanel }
