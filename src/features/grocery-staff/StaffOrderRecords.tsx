import type { ReactNode } from "react"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Typography } from "@/components/foundation/Typography"
import { formatDay, formatPaisa, formatStamp } from "@/features/grocery/format"
import { formatAmount } from "@/features/grocery/quantity"
import { PAID_BY } from "@/features/grocery/paymentCopy"
import { STATUS_META } from "@/features/grocery/orderStatus"
import { ISSUE_LABEL, ITEM_SUBSTITUTION, METHOD_NAME, REFUND_METHOD_NAME, memberName } from "@/features/grocery-staff/staffLabels"
import { formatPhone, telHref } from "@/lib/phone"
import type {
  GroceryStaffConfirmationDto,
  GroceryStaffEventDto,
  GroceryStaffOrderDetailDto,
} from "@/lib/api/dto/groceryStaff"

/** The records of one order, in the order a person handling it needs them. All of it is the server's. */

function Panel({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <Typography as="h2" id={id} variant="h3" className="text-lg">
          {title}
        </Typography>
        {hint && (
          <Typography variant="caption" className="text-muted-foreground">
            {hint}
          </Typography>
        )}
      </div>
      {children}
    </section>
  )
}

function Pair({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

const PAIRS = "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm"

function CustomerPanel({ order }: { order: GroceryStaffOrderDetailDto }) {
  const { delivery } = order
  const call = telHref(delivery.contactPhone)
  return (
    <Panel id="staff-customer" title="Customer and delivery">
      <dl className={PAIRS}>
        <Pair term="Name">{delivery.contactName}</Pair>
        <Pair term="Phone">{formatPhone(delivery.contactPhone)}</Pair>
        <Pair term="Block">{delivery.block}</Pair>
        <Pair term="Address">{delivery.addressLine}</Pair>
        {delivery.landmark && <Pair term="Landmark">{delivery.landmark}</Pair>}
      </dl>
      {call && (
        <Button asChild variant="outline" className="h-11 self-start">
          <a href={call}>
            <Phone aria-hidden="true" />
            Call customer
          </a>
        </Button>
      )}
    </Panel>
  )
}

function RequestPanel({ order }: { order: GroceryStaffOrderDetailDto }) {
  return (
    <Panel
      id="staff-items"
      title={order.items.length === 1 ? "1 item requested" : `${order.items.length} items requested`}
      hint="What the customer asked for, as they wrote it."
    >
      <ol className="flex flex-col divide-y divide-border">
        {order.items.map((item) => (
          <li key={item.position} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
            <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-semibold tabular-nums">
              {item.position}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Typography as="span" variant="label" className="min-w-0 break-words text-base">
                  {item.name}
                </Typography>
                <Typography as="span" variant="body-sm" className="font-semibold tabular-nums">
                  {formatAmount(item.quantity, item.unit)}
                </Typography>
              </div>
              {item.preferredBrand && (
                <Typography as="span" variant="body-sm" className="break-words">
                  Brand: {item.preferredBrand}
                </Typography>
              )}
              <Typography as="span" variant="body-sm" className="text-muted-foreground">
                {ITEM_SUBSTITUTION[item.substitution]}
              </Typography>
              {item.note && (
                <Typography as="span" variant="body-sm" className="break-words text-muted-foreground">
                  Customer's note: {item.note}
                </Typography>
              )}
            </div>
          </li>
        ))}
      </ol>
      {order.instructions && (
        <div className="rounded-xl bg-muted/60 p-3">
          <Typography as="h3" variant="label">
            Customer's instructions
          </Typography>
          <Typography variant="body-sm" className="whitespace-pre-line break-words">
            {order.instructions}
          </Typography>
        </div>
      )}
    </Panel>
  )
}

function Agreement({ record, viewerId, current }: { record: GroceryStaffConfirmationDto; viewerId: string; current: boolean }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Typography as="h3" variant="label">
          {current ? "Latest agreement" : "Earlier agreement"} (no. {record.sequence})
        </Typography>
        <Typography as="span" variant="label" className="text-base tabular-nums">
          {formatPaisa(record.totalPaisa)}
        </Typography>
      </div>
      <dl className={PAIRS}>
        <Pair term="Items">{formatPaisa(record.itemsSubtotalPaisa)}</Pair>
        <Pair term="Service fee">{formatPaisa(record.serviceFeePaisa)}</Pair>
        <Pair term="Delivery fee">{formatPaisa(record.deliveryFeePaisa)}</Pair>
        <Pair term="How">{METHOD_NAME[record.method]}</Pair>
        <Pair term="Substitute agreed">{record.substitutionsAgreed ? "Yes" : "No"}</Pair>
        {record.consentNote && (
          <Pair term="Agreement note">
            <span className="whitespace-pre-line">{record.consentNote}</span>
          </Pair>
        )}
        {record.pricingNote && <Pair term="Pricing note">{record.pricingNote}</Pair>}
        <Pair term="Recorded by">
          {memberName(record.recordedBy, viewerId)}, {formatStamp(record.recordedAt)}
        </Pair>
      </dl>
    </li>
  )
}

function AgreementsPanel({ order, viewerId }: { order: GroceryStaffOrderDetailDto; viewerId: string }) {
  const newestFirst = [...order.confirmations].sort((a, b) => b.sequence - a.sequence)
  return (
    <Panel
      id="staff-agreements"
      title="Recorded agreements"
      hint="What a staff member recorded after speaking with the customer. Not an approval the customer gave in the app."
    >
      {newestFirst.length === 0 ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          No price has been recorded.
        </Typography>
      ) : (
        <ol className="flex flex-col gap-2">
          {newestFirst.map((record, index) => (
            <Agreement key={record.sequence} record={record} viewerId={viewerId} current={index === 0} />
          ))}
        </ol>
      )}
    </Panel>
  )
}

function PaymentPanel({ order, viewerId }: { order: GroceryStaffOrderDetailDto; viewerId: string }) {
  const { payment, refund, finalAmountDuePaisa: due, agreedTotalPaisa: agreed } = order
  const unpaid = order.recordableMethods?.length ? "Not paid yet." : "Not collected. Cash on delivery."
  const lowered = due !== undefined && agreed !== undefined && due < agreed
  return (
    <Panel id="staff-payment" title="Amount due and payment">
      <dl className={PAIRS}>
        {agreed !== undefined && <Pair term="Latest agreed total">{formatPaisa(agreed)}</Pair>}
        <Pair term={order.status === "cancelled" ? "Amount on record" : "Amount due"}>
          <span className="font-semibold tabular-nums">{due === undefined ? "Not recorded" : formatPaisa(due)}</span>
          {lowered && " (lowered after the agreement)"}
        </Pair>
        <Pair term="Payment">
          {payment ? (
            <>
              <span className="font-semibold">
                {payment.method === "cash_on_delivery" ? "Cash collected" : `Paid ${PAID_BY[payment.method]}`}:{" "}
                {formatPaisa(payment.amountCollectedPaisa)}
              </span>
              {payment.reference && <span className="block break-all">Reference: {payment.reference}</span>}
              <span className="block text-muted-foreground">
                {payment.method === "cash_on_delivery" ? "Recorded" : "Verified"} by{" "}
                {memberName(payment.collectedBy, viewerId)}, {formatStamp(payment.collectedAt)}
              </span>
            </>
          ) : order.status === "cancelled" ? (
            "No payment was recorded."
          ) : (
            unpaid
          )}
        </Pair>
        {refund && (
          <Pair term="Refund">
            <span className="font-semibold">
              Refunded: {formatPaisa(refund.amountPaisa)}, {REFUND_METHOD_NAME[refund.method]}
            </span>
            {refund.reference && <span className="block break-all">Reference: {refund.reference}</span>}
            <span className="block break-words">Reason: {refund.reason}</span>
            <span className="block text-muted-foreground">
              Recorded by {memberName(refund.refundedBy, viewerId)}, {formatStamp(refund.refundedAt)}
            </span>
          </Pair>
        )}
        <Pair term="Counts toward">{formatDay(`${order.serviceDate}T12:00:00+05:00`)}</Pair>
      </dl>
    </Panel>
  )
}

const OUTCOME = { in_progress: "On the way", failed: "Failed", delivered: "Delivered" } as const

function AttemptsPanel({ order, viewerId }: { order: GroceryStaffOrderDetailDto; viewerId: string }) {
  if (order.deliveryAttempts.length === 0) return null
  return (
    <Panel id="staff-attempts" title="Delivery attempts">
      <ol className="flex flex-col divide-y divide-border">
        {order.deliveryAttempts.map((attempt) => (
          <li key={attempt.attempt} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
            <span className="font-medium">
              Attempt {attempt.attempt}: {OUTCOME[attempt.outcome]}
            </span>
            <span className="text-muted-foreground">
              Sent out by {memberName(attempt.dispatchedBy, viewerId)}, {formatStamp(attempt.dispatchedAt)}
            </span>
            {attempt.note && <span className="break-words">Dispatch note: {attempt.note}</span>}
            {attempt.outcomeAt && (
              <span className="text-muted-foreground">
                {OUTCOME[attempt.outcome]} recorded by {memberName(attempt.outcomeBy, viewerId)}, {formatStamp(attempt.outcomeAt)}
              </span>
            )}
            {attempt.failureReason && <span className="break-words">Reason: {attempt.failureReason}</span>}
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function HistoryPanel({ order, viewerId }: { order: GroceryStaffOrderDetailDto; viewerId: string }) {
  return (
    <Panel id="staff-history" title="Status history">
      <ol className="flex flex-col divide-y divide-border">
        {order.history.map((row, index) => (
          <li key={`${row.createdAt}-${index}`} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
            <span className="font-medium">
              {row.fromStatus ? `${STATUS_META[row.fromStatus].label} → ` : ""}
              {STATUS_META[row.toStatus].label}
            </span>
            <span className="text-muted-foreground">
              {row.actorRole === "customer" ? "Customer" : memberName(row.actor, viewerId)}, {formatStamp(row.createdAt)}
            </span>
            {row.reason && (
              <span className="break-words">
                {row.actorRole === "customer" ? "Customer's reason" : "Internal reason"}: {row.reason}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function eventText(event: GroceryStaffEventDto, viewerId: string): string {
  const who = memberName(event.actor, viewerId)
  switch (event.action) {
    case "claimed":
      return `${who} claimed the order`
    case "released":
      return event.subject && event.subject.userId !== event.actor.userId
        ? `${who} released it from ${memberName(event.subject, viewerId)}`
        : `${who} released the order`
    case "amount_reduced":
      return event.amountBeforePaisa !== undefined && event.amountAfterPaisa !== undefined
        ? `${who} lowered the amount from ${formatPaisa(event.amountBeforePaisa)} to ${formatPaisa(event.amountAfterPaisa)}`
        : `${who} lowered the amount`
    case "issue_recorded":
      return `${who} recorded an issue${event.issueKind ? `: ${ISSUE_LABEL[event.issueKind]}` : ""}`
  }
}

function StaffLogPanel({ order, viewerId }: { order: GroceryStaffOrderDetailDto; viewerId: string }) {
  return (
    <Panel id="staff-log" title="Staff notes and issues" hint="Internal. Customers never see this.">
      {order.events.length === 0 ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          Nothing recorded yet.
        </Typography>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {order.events.map((event, index) => (
            <li key={`${event.createdAt}-${index}`} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
              <span className="break-words font-medium">{eventText(event, viewerId)}</span>
              {event.note && <span className="whitespace-pre-line break-words">{event.note}</span>}
              <span className="text-muted-foreground">{formatStamp(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

export { AgreementsPanel, AttemptsPanel, CustomerPanel, HistoryPanel, PaymentPanel, RequestPanel, StaffLogPanel }
