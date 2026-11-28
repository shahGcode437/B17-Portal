import { Link, Navigate } from "react-router-dom"
import { ArrowLeft, ClipboardCheck, Loader2, PhoneCall, Send } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/workspace/PageHeader"
import { AttentionRegion } from "@/features/grocery/AttentionRegion"
import { AvailabilityStatus } from "@/features/grocery/AvailabilityStatus"
import { canWriteAnOrder } from "@/features/grocery/availabilityCopy"
import { GrocerySteps } from "@/features/grocery/GrocerySteps"
import { GroceryUnavailable } from "@/features/grocery/GroceryUnavailable"
import { ItemDetails } from "@/features/grocery/ItemRow"
import { AuthUnreachable, VerifyToOrder } from "@/features/grocery/SignInGatePanel"
import { RefusedAlert, UnconfirmedPanel } from "@/features/grocery/SubmissionStatus"
import { buildOrderRequest, deliverySchema } from "@/features/grocery/orderRequest"
import { PRICE_CONFIRMED, offeredMethods, paymentCopy } from "@/features/grocery/paymentCopy"
import { RecoveryNotice } from "@/features/grocery/RecoveryNotice"
import { useUncheckedSubmission } from "@/features/grocery/useUncheckedSubmission"
import { useGroceryAvailability } from "@/features/grocery/useGroceryAvailability"
import { SubmissionFailed, SubmissionSuperseded, isDraftHidden, useGroceryDraft } from "@/features/grocery/groceryDraftStore"
import { useAuth } from "@/hooks/useAuth"
import { useRequireOnline } from "@/hooks/useRequireOnline"
import { grocerySubmittedPath, routes } from "@/config/routes"
import { formatPhone } from "@/lib/phone"

/** Refusals after which the availability on screen is out of date. */
const STALE_AFTER = ["grocery_closed", "grocery_unavailable", "grocery_capacity_reached", "validation_error"]

function Summary({ title, editTo, editLabel, locked, children }: { title: string; editTo: string; editLabel: string; locked: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <Typography as="h2" variant="h3" className="text-lg">
          {title}
        </Typography>
        {!locked && (
          <Link to={editTo} className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-medium text-primary underline underline-offset-4">
            {editLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * Step 3: check and send (GROCERY-3A). The submission itself lives in the draft store: double
 * clicks share one request, an unknown outcome is retried only with the same key, and a success
 * moves on to the confirmation.
 */
function GroceryReviewPage() {
  const { user, status, refreshMe } = useAuth()
  const availability = useGroceryAvailability()
  const requireOnline = useRequireOnline()
  const draft = useGroceryDraft()
  const hidden = isDraftHidden(draft.ownerId, user?.id ?? null)
  const locked = draft.phase !== "idle"
  const data = availability.data
  const unchecked = useUncheckedSubmission()

  // The order this page just sent: on to its confirmation (the draft is already cleared).
  if (draft.sentOrderId && draft.items.length === 0) return <Navigate to={grocerySubmittedPath(draft.sentOrderId)} replace />
  if (status !== "loading") {
    if (hidden || draft.items.length === 0) return <Navigate to={routes.groceryNew} replace />
    if (status === "anonymous") return <Navigate to={routes.groceryDelivery} replace />
  }
  if (!locked && data && canWriteAnOrder(data) && !deliverySchema(data.serviceableBlocks).safeParse(draft.delivery).success) {
    return <Navigate to={routes.groceryDelivery} replace />
  }

  async function run(send: () => Promise<string>) {
    if (!requireOnline()) return
    try {
      await send()
    } catch (cause) {
      if (cause instanceof SubmissionSuperseded) return
      if (!(cause instanceof SubmissionFailed)) throw cause
      const { code } = cause.problem.error
      if (STALE_AFTER.includes(code)) availability.refresh()
      if (code === "email_not_verified") void refreshMe({ fresh: true })
    }
  }

  const send = () =>
    // A kept (unconfirmed) attempt is always resent as it was; otherwise the request is built now.
    void run(() => (draft.attempt ? draft.retry() : draft.submit(buildOrderRequest(draft.items, draft.delivery))))
  const sending = draft.phase === "sending"
  const verified = Boolean(user?.emailVerified)
  // A send a reload cut off must be checked before another order can go.
  const mustCheck = unchecked !== null && draft.phase === "idle"
  const closed = Boolean(data && !data.acceptingOrders)
  const delivery = draft.attempt?.request.delivery
  const shownDelivery = delivery ?? buildOrderRequest(draft.items, draft.delivery).delivery
  const instructions = draft.attempt ? draft.attempt.request.instructions : draft.delivery.instructions.trim()

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <PageHeader
          icon={ClipboardCheck}
          eyebrow="Grocery"
          title="Check your order"
          description="Make sure the list and the address are right before sending."
          meta={<GrocerySteps current={3} />}
        />

        {status === "loading" || (availability.loading && !locked) ? (
          <div role="status" aria-label="Preparing your review">
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        ) : status === "unavailable" ? (
          <AuthUnreachable />
        ) : !locked && data && !canWriteAnOrder(data) ? (
          <GroceryUnavailable availability={data} keptItems={draft.items.length} />
        ) : (
          <>
            {draft.phase === "unconfirmed" && (
              <AttentionRegion signal={draft.problem}>
                <UnconfirmedPanel problem={draft.problem} sending={sending} onRetry={send} onDiscard={draft.discardAttempt} />
              </AttentionRegion>
            )}
            {draft.phase === "idle" && draft.problem?.kind === "refused" && (
              <AttentionRegion signal={draft.problem}>
                <RefusedAlert problem={draft.problem} />
              </AttentionRegion>
            )}
            {mustCheck && <RecoveryNotice />}
            <VerifyToOrder />

            <Summary title={`Your list (${draft.items.length === 1 ? "1 item" : `${draft.items.length} items`})`} editTo={routes.groceryNew} editLabel="Edit list" locked={locked}>
              <ol className="flex flex-col divide-y divide-border">
                {draft.items.map((item) => (
                  <li key={item.id} className="flex py-2.5 first:pt-0 last:pb-0">
                    <ItemDetails {...item} />
                  </li>
                ))}
              </ol>
            </Summary>

            <Summary title="Delivery" editTo={routes.groceryDelivery} editLabel="Edit details" locked={locked}>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="break-words">{shownDelivery.contactName}</dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{formatPhone(shownDelivery.contactPhone)}</dd>
                <dt className="text-muted-foreground">Block</dt>
                <dd>{shownDelivery.block}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="break-words">{shownDelivery.addressLine}</dd>
                {shownDelivery.landmark && (
                  <>
                    <dt className="text-muted-foreground">Landmark</dt>
                    <dd className="break-words">{shownDelivery.landmark}</dd>
                  </>
                )}
                {instructions && (
                  <>
                    <dt className="text-muted-foreground">Instructions</dt>
                    <dd className="whitespace-pre-line break-words">{instructions}</dd>
                  </>
                )}
              </dl>
            </Summary>

            <section aria-label="Price and payment" className="flex items-start gap-3 rounded-2xl bg-info/10 p-4 ring-1 ring-info/25">
              <PhoneCall className="mt-0.5 size-5 shrink-0 text-info-text" aria-hidden="true" />
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-semibold">Your total is confirmed before preparation</p>
                <p>
                  {PRICE_CONFIRMED} {paymentCopy(offeredMethods(data)).howToPay} You can cancel here until the price is
                  confirmed.
                </p>
              </div>
            </section>

            {closed && !locked && data && (
              <AvailabilityStatus availability={data} onRefresh={availability.refresh} refreshing={availability.refreshing} />
            )}

            {draft.phase !== "unconfirmed" && (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button asChild variant="outline" className="h-11">
                  <Link to={routes.groceryDelivery}>
                    <ArrowLeft />
                    Back
                  </Link>
                </Button>
                <Button type="button" className="h-12 text-base sm:px-8" onClick={send} disabled={sending || !verified || closed || mustCheck}>
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}
                  {sending ? "Sending your order…" : "Send my order"}
                </Button>
              </div>
            )}
            <p role="status" className="sr-only">
              {sending ? "Sending your order." : ""}
            </p>
            {mustCheck && (
              <Typography variant="body-sm" className="text-muted-foreground sm:text-right">
                Check your last order above before sending this one.
              </Typography>
            )}
            {!verified && (
              <Typography variant="body-sm" className="text-muted-foreground sm:text-right">
                Verify your email address to send the order.
              </Typography>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

export { GroceryReviewPage }
