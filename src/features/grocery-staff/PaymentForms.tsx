import { useId, useState } from "react"
import { CheckField } from "@/components/forms/CheckField"
import { formatPaisa } from "@/features/grocery/format"
import { PAYMENT_METHOD_NAME } from "@/features/grocery/paymentCopy"
import { AmountDue, AmountField, ChoiceField, NoteField } from "@/features/grocery-staff/StaffFields"
import { StaffActionDialog } from "@/features/grocery-staff/StaffActionDialog"
import { useStaffForm, type StaffFormProps } from "@/features/grocery-staff/useStaffForm"
import { amountProblem, parsePkr } from "@/features/grocery-staff/money"
import { focusFirstProblem } from "@/features/grocery-staff/fieldFocus"
import { recordGroceryPayment, recordGroceryRefund } from "@/lib/api/writes/groceryStaff"
import type { GroceryRecordableMethodDto, GroceryRefundMethodDto } from "@/lib/api/dto/groceryStaff"

/**
 * Recording money (GROCERY-4C, API_CONTRACT §21). Neither form moves any money: one records a
 * payment staff have VERIFIED, the other a refund already made outside this application. The server
 * decides who may, how much and which reference is acceptable.
 */

const REFUND_OPTIONS: { value: GroceryRefundMethodDto; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Back to the card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "easypaisa", label: "Easypaisa" },
  { value: "jazzcash", label: "JazzCash" },
]

/** The server stores references without spaces or hyphens and needs at least four characters. */
function referenceProblem(reference: string, required: boolean): string | undefined {
  const compact = reference.replace(/[\s-]/g, "")
  if (!compact) return required ? "Enter the transaction reference." : undefined
  return compact.length < 4 ? "A reference has at least 4 letters or numbers." : undefined
}

/** The amount typed must be the whole figure: nothing is filled in for the person. */
function wholeAmountProblem(typed: string, expected: number | undefined, partial: string): string | undefined {
  const problem = amountProblem(typed, { allowZero: false }) ?? undefined
  const parsed = parsePkr(typed)
  if (!problem && parsed.ok && expected !== undefined && parsed.paisa !== expected) {
    return `Enter exactly ${formatPaisa(expected)}. ${partial}`
  }
  return problem
}

interface PaymentProblems {
  method?: string
  amount?: string
  reference?: string
  verified?: string
}

function RecordPaymentForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("record_payment", props)
  const due = props.order.finalAmountDuePaisa
  const [method, setMethod] = useState<GroceryRecordableMethodDto | null>(null)
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [verified, setVerified] = useState(false)
  const [problems, setProblems] = useState<PaymentProblems>({})

  function onSubmit() {
    const found: PaymentProblems = {
      method: method ? undefined : "Choose how the customer paid.",
      amount: wholeAmountProblem(amount, due, "Part payments can't be recorded."),
      reference: referenceProblem(reference, true),
      verified: verified ? undefined : "Record a payment only after checking the money was received.",
    }
    setProblems(found)
    const parsed = parsePkr(amount)
    if (!method || !parsed.ok || Object.values(found).some(Boolean)) {
      return focusFirstProblem(id, ["method", "amount", "reference", "verified"], { ...found })
    }
    void submit((signal) =>
      recordGroceryPayment(
        props.order.id,
        { revision, method, amountPaisa: parsed.paisa, reference: reference.trim(), moneyVerified: true },
        signal
      )
    )
  }

  return (
    <StaffActionDialog
      pending={props.pending}
      onClose={props.onClose}
      pageExplains={props.pageExplains}
      title="Record a verified payment"
      description="For money already received. It doesn't mark the order delivered, and it can't be edited or removed."
      submitLabel="Record payment"
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <AmountDue label="Amount due" paisa={due} />
      <ChoiceField
        id={`${id}-method`}
        legend="How the customer paid"
        options={(props.order.recordableMethods ?? []).map((value) => ({ value, label: PAYMENT_METHOD_NAME[value] }))}
        value={method}
        onChange={setMethod}
        error={problems.method}
      />
      <AmountField id={`${id}-amount`} label="Amount received (Rs)" value={amount} onChange={setAmount} error={problems.amount} />
      <NoteField
        id={`${id}-reference`}
        label="Transaction reference"
        oneLine
        hint="The transaction ID from the bank or wallet, or the card machine's receipt or approval number. Never a card number or account number."
        value={reference}
        onChange={setReference}
        maxLength={100}
        error={problems.reference}
      />
      <CheckField
        id={`${id}-verified`}
        label="I checked that this money was received."
        hint="A screenshot or the customer's word isn't enough: check the business account or the card machine."
        checked={verified}
        onChange={setVerified}
        error={problems.verified}
      />
    </StaffActionDialog>
  )
}

interface RefundProblems {
  amount?: string
  method?: string
  reference?: string
  reason?: string
  returned?: string
  acknowledged?: string
}

function RefundForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("record_refund", props)
  const paid = props.order.payment?.amountCollectedPaisa
  // As the order stood when the form opened; if it changes, the form is outdated.
  const [delivered] = useState(props.order.status === "delivered")
  const [afterBuying] = useState(props.order.status === "preparing")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<GroceryRefundMethodDto | null>(null)
  const [reference, setReference] = useState("")
  const [reason, setReason] = useState("")
  const [returned, setReturned] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [problems, setProblems] = useState<RefundProblems>({})

  function onSubmit() {
    const found: RefundProblems = {
      amount: wholeAmountProblem(amount, paid, "Partial refunds can't be recorded."),
      method: method ? undefined : "Choose how the money was returned.",
      reference: referenceProblem(reference, method !== null && method !== "cash"),
      reason: reason.trim() ? undefined : "Write why the payment was refunded.",
      returned: returned ? undefined : "Record a refund only after the money has been returned.",
      acknowledged: afterBuying && !acknowledged ? "Confirm that goods may already have been bought." : undefined,
    }
    setProblems(found)
    const parsed = parsePkr(amount)
    if (!method || !parsed.ok || Object.values(found).some(Boolean)) {
      return focusFirstProblem(id, ["amount", "method", "reference", "reason", "returned", "acknowledged"], { ...found })
    }
    const sent = reference.trim()
    void submit((signal) =>
      recordGroceryRefund(
        props.order.id,
        {
          revision,
          amountPaisa: parsed.paisa,
          method,
          ...(sent ? { reference: sent } : {}),
          reason: reason.trim(),
          moneyReturned: true,
          ...(afterBuying ? { procurementAcknowledged: true } : {}),
        },
        signal
      )
    )
  }

  return (
    <StaffActionDialog
      pending={props.pending}
      onClose={props.onClose}
      pageExplains={props.pageExplains}
      title={`Record a refund for order ${props.order.reference}`}
      description={`This app returns no money: return it first, then record it here. ${
        delivered ? "The order stays delivered." : "This also cancels the order."
      } It can't be undone, and the app doesn't send the customer a message.`}
      submitLabel={delivered ? "Record refund" : "Record refund and cancel order"}
      pendingLabel="Recording…"
      destructive
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <AmountDue label="Paid" paisa={paid} />
      <AmountField id={`${id}-amount`} label="Amount returned (Rs)" value={amount} onChange={setAmount} error={problems.amount} />
      <ChoiceField
        id={`${id}-method`}
        legend="How it was returned"
        options={REFUND_OPTIONS}
        value={method}
        onChange={setMethod}
        error={problems.method}
      />
      <NoteField
        id={`${id}-reference`}
        label="Refund reference"
        optional={method === "cash"}
        oneLine
        hint="The reference of the money you sent back. Never a card number or account number."
        value={reference}
        onChange={setReference}
        maxLength={100}
        error={problems.reference}
      />
      <NoteField
        id={`${id}-reason`}
        label="Reason"
        oneLine
        hint="Internal. Customers don't see it."
        value={reason}
        onChange={setReason}
        maxLength={200}
        error={problems.reason}
      />
      <CheckField
        id={`${id}-returned`}
        label="The whole amount has been returned to the customer."
        checked={returned}
        onChange={setReturned}
        error={problems.returned}
      />
      {afterBuying && (
        <CheckField
          id={`${id}-acknowledged`}
          label="I understand that goods may already have been bought for this order."
          hint="An issue is left on the order for someone to resolve by hand."
          checked={acknowledged}
          onChange={setAcknowledged}
          error={problems.acknowledged}
        />
      )}
    </StaffActionDialog>
  )
}

export { RecordPaymentForm, RefundForm }
