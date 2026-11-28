import { Banknote } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { METHOD_LABEL, formatPaisa, formatStamp } from "@/features/grocery/format"
import type { GroceryAgreementDto, GroceryOrderDetailDto } from "@/lib/api/dto/grocery"

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-4 text-base font-semibold" : "flex justify-between gap-4 text-sm"}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function recordedLine(agreement: GroceryAgreementDto): string {
  // What a staff member RECORDED: never worded as an approval the customer gave in the app.
  return `Recorded by our team ${METHOD_LABEL[agreement.method]}, ${formatStamp(agreement.recordedAt)}.`
}

/**
 * Price and cash on delivery. Every figure is the server's: the recorded totals, any later
 * reduction of the amount due, and the cash collected. Nothing is calculated that the server did not
 * send, except the size of a reduction (the difference of two of its whole-paisa figures).
 */
function PriceCard({ order }: { order: GroceryOrderDetailDto }) {
  const latest = order.agreements.at(-1)
  const earlier = order.agreements.slice(0, -1)
  const cancelled = order.status === "cancelled"
  const due = order.finalAmountDuePaisa
  const reduction =
    latest && due !== undefined && order.agreedTotalPaisa !== undefined && due < order.agreedTotalPaisa
      ? order.agreedTotalPaisa - due
      : 0

  return (
    <section aria-labelledby="grocery-price" className="glass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
      <Typography as="h2" id="grocery-price" variant="h3" className="text-lg">
        Price and payment
      </Typography>

      {!latest ? (
        <Typography variant="body-sm" className="text-muted-foreground">
          {cancelled
            ? "No price was recorded for this order."
            : "No price yet. Our team will confirm the total with you before preparing your order."}
        </Typography>
      ) : (
        <>
          <dl className="flex flex-col gap-1.5">
            <Row label="Items" value={formatPaisa(latest.itemsSubtotalPaisa)} />
            <Row label="Service fee" value={formatPaisa(latest.serviceFeePaisa)} />
            <Row label="Delivery fee" value={formatPaisa(latest.deliveryFeePaisa)} />
            <div className="my-1 h-px bg-border" aria-hidden="true" />
            <Row label="Recorded total" value={formatPaisa(latest.totalPaisa)} strong={reduction === 0} />
            {reduction > 0 && due !== undefined && (
              <>
                <Row label="Reduced by" value={`− ${formatPaisa(reduction)}`} />
                <Row label={cancelled ? "Amount after reduction" : "Final amount"} value={formatPaisa(due)} strong />
              </>
            )}
          </dl>
          <Typography variant="body-sm" className="text-muted-foreground">
            {recordedLine(latest)}
            {!cancelled && " If it doesn't match what you discussed, tell our team when they contact you."}
          </Typography>
        </>
      )}

      {earlier.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-3">
          <Typography as="h3" variant="label">
            Earlier recorded totals
          </Typography>
          <ul className="flex flex-col gap-1">
            {earlier.map((agreement) => (
              <li key={agreement.sequence} className="flex justify-between gap-4 text-sm text-muted-foreground">
                <span>{formatStamp(agreement.recordedAt)}</span>
                <span className="tabular-nums">{formatPaisa(agreement.totalPaisa)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cancelled ? (
        latest && (
          <Typography variant="body-sm" className="text-muted-foreground">
            This order was cancelled. The figures above are its record.
          </Typography>
        )
      ) : order.payment ? (
        <div className="flex items-start gap-3 rounded-xl bg-primary/8 p-3 ring-1 ring-primary/20">
          <Banknote className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <Typography as="p" variant="label" className="text-base">
              {order.payment.status === "collected" && order.payment.amountCollectedPaisa !== undefined
                ? `Paid in cash: ${formatPaisa(order.payment.amountCollectedPaisa)}`
                : `Cash on delivery: ${formatPaisa(order.payment.amountDuePaisa)}`}
            </Typography>
            <Typography variant="body-sm" className="text-muted-foreground">
              {order.payment.status === "collected" && order.payment.collectedAt
                ? `Received ${formatStamp(order.payment.collectedAt)}.`
                : "Pay this in cash when your order arrives."}
            </Typography>
          </div>
        </div>
      ) : (
        <Typography variant="body-sm" className="text-muted-foreground">
          Payment is cash on delivery.
        </Typography>
      )}
    </section>
  )
}

export { PriceCard }
