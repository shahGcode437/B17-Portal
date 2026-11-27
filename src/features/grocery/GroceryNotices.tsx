import { useNavigate, Link } from "react-router-dom"
import { CircleCheck, LockKeyhole, TriangleAlert } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { grocerySubmittedPath, routes } from "@/config/routes"

/** An order that was sent while the customer was on another page: say so, once, with a way to it. */
function SentNotice() {
  const sentOrderId = useGroceryDraft((draft) => draft.sentOrderId)
  if (!sentOrderId) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-success/10 p-4 ring-1 ring-success/30">
      <CircleCheck className="size-5 shrink-0 text-success-text" aria-hidden="true" />
      <Typography variant="body-sm" className="min-w-0 flex-1 font-medium">
        Your grocery order was sent.
      </Typography>
      <Button asChild variant="outline" className="h-11">
        <Link to={grocerySubmittedPath(sentOrderId)}>See your order</Link>
      </Button>
    </div>
  )
}

/** An order whose outcome is unknown: editing is locked until it is resolved on the review step. */
function UnconfirmedBanner() {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/35">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
      <Typography variant="body-sm" className="min-w-0 flex-1 font-medium">
        We haven't been able to confirm your last order. Finish it on the review step before changing your list.
      </Typography>
      <Button asChild className="h-11">
        <Link to={routes.groceryReview}>Go to review</Link>
      </Button>
    </div>
  )
}

/**
 * A list that belongs to an account nobody is signed in to (the session ended). Its contents are not
 * shown: signing in as that account brings it back; starting again discards it.
 */
function HiddenDraftPanel({ from }: { from: string }) {
  const navigate = useNavigate()
  const reset = useGroceryDraft((draft) => draft.reset)
  return (
    <div className="glass-panel flex flex-col items-center gap-4 rounded-2xl p-6 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
        <LockKeyhole className="size-6" />
      </span>
      <Typography as="h2" variant="h3">
        Sign in to continue your list
      </Typography>
      <Typography variant="body" className="max-w-md text-muted-foreground">
        A grocery list was started in this tab while signed in. Sign in with the same account to continue it, or start a
        new one.
      </Typography>
      <div className="flex flex-wrap justify-center gap-2">
        <Button className="h-11" onClick={() => navigate(routes.login, { state: { from } })}>
          Log in
        </Button>
        <Button variant="outline" className="h-11" onClick={reset}>
          Start a new list
        </Button>
      </div>
    </div>
  )
}

export { SentNotice, UnconfirmedBanner, HiddenDraftPanel }
