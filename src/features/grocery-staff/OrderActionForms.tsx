import { useId, useState } from "react"
import { formatPaisa } from "@/features/grocery/format"
import { AgreementForm } from "@/features/grocery-staff/AgreementForm"
import { CheckField } from "@/components/forms/CheckField"
import { AmountDue, AmountField, ChoiceField, NoteField } from "@/features/grocery-staff/StaffFields"
import { StaffActionDialog } from "@/features/grocery-staff/StaffActionDialog"
import { useStaffForm, type StaffFormProps } from "@/features/grocery-staff/useStaffForm"
import { amountProblem, parsePkr } from "@/features/grocery-staff/money"
import { focusFirstProblem } from "@/features/grocery-staff/fieldFocus"
import { ISSUE_LABEL, RECORDABLE_ISSUES } from "@/features/grocery-staff/staffLabels"
import { RecordPaymentForm, RefundForm } from "@/features/grocery-staff/PaymentForms"
import {
  cancelGroceryOrderAsStaff,
  completeGroceryOrder,
  dispatchGroceryOrder,
  recordFailedGroceryDelivery,
  recordGroceryIssue,
  reduceGroceryAmount,
  releaseGroceryOrder,
  startPreparingGroceryOrder,
} from "@/lib/api/writes/groceryStaff"
import type { GroceryRecordableIssueDto, GroceryStaffActionDto } from "@/lib/api/dto/groceryStaff"

/** What the dialog shell needs from a form's props. */
function shell({ pending, onClose, pageExplains }: StaffFormProps) {
  return { pending, onClose, pageExplains }
}

function ReleaseForm(props: StaffFormProps) {
  const { refusal, outdated, submit } = useStaffForm("release", props)
  return (
    <StaffActionDialog
      {...shell(props)}
      title={`Release order ${props.order.reference}?`}
      description="Nobody will hold it. It can be claimed again by any of the grocery team."
      submitLabel="Release order"
      pendingLabel="Releasing…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={() => void submit((signal) => releaseGroceryOrder(props.order.id, signal))}
    />
  )
}

function StartPreparingForm(props: StaffFormProps) {
  const { revision, refusal, outdated, submit } = useStaffForm("start_preparing", props)
  return (
    <StaffActionDialog
      {...shell(props)}
      title="Start buying and preparing?"
      description="Do this when buying is about to start. From then on only a Super Admin can cancel the order, and the customer can't."
      submitLabel="Start preparing"
      pendingLabel="Starting…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={() => void submit((signal) => startPreparingGroceryOrder(props.order.id, { revision }, signal))}
    >
      <AmountDue label="Amount due" paisa={props.order.finalAmountDuePaisa} />
    </StaffActionDialog>
  )
}

function DispatchForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("dispatch", props)
  const [note, setNote] = useState("")
  return (
    <StaffActionDialog
      {...shell(props)}
      title="Send out for delivery?"
      description="Only when the order has actually left. The app doesn't send the customer a message."
      submitLabel="Out for delivery"
      pendingLabel="Saving…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={() => {
        const text = note.trim()
        void submit((signal) =>
          dispatchGroceryOrder(props.order.id, text ? { revision, note: text } : { revision }, signal)
        )
      }}
    >
      <AmountDue
        label={
          props.order.payment
            ? "Already paid. Collect nothing"
            : props.order.recordableMethods?.length
              ? "To collect, if not paid first"
              : "Cash to collect"
        }
        paisa={props.order.finalAmountDuePaisa}
      />
      <NoteField
        id={`${id}-note`}
        label="Dispatch note"
        optional
        oneLine
        hint="Internal. For example, who is carrying the order."
        value={note}
        onChange={setNote}
        maxLength={200}
      />
    </StaffActionDialog>
  )
}

function DeliveryFailedForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("delivery_failed", props)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string>()
  return (
    <StaffActionDialog
      {...shell(props)}
      title="Record a failed delivery"
      description="The order goes back to preparing. Nothing is delivered or paid. Tell the customer yourself about the next attempt."
      submitLabel="Record failed delivery"
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={() => {
        const text = reason.trim()
        const problem = text ? undefined : "Write why the delivery didn't complete."
        setError(problem)
        if (problem) return focusFirstProblem(id, ["reason"], { reason: problem })
        void submit((signal) => recordFailedGroceryDelivery(props.order.id, { revision, reason: text }, signal))
      }}
    >
      <NoteField
        id={`${id}-reason`}
        label="Reason"
        oneLine
        hint="Internal. Customers don't see it."
        value={reason}
        onChange={setReason}
        maxLength={200}
        error={error}
      />
    </StaffActionDialog>
  )
}

/** A paid order: only the handover is recorded. Nothing is collected a second time. */
function CompletePaidForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("complete", props)
  const [handedOver, setHandedOver] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <StaffActionDialog
      {...shell(props)}
      title="Record delivery"
      description="This order is already paid: collect nothing. Recording the delivery can't be undone."
      submitLabel="Record delivered"
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={() => {
        const problem = handedOver ? undefined : "Record this only after the order was handed over."
        setError(problem)
        if (problem) return focusFirstProblem(id, ["handed"], { handed: problem })
        void submit((signal) => completeGroceryOrder(props.order.id, { revision }, signal))
      }}
    >
      <AmountDue label="Already paid" paisa={props.order.payment?.amountCollectedPaisa} />
      <CheckField
        id={`${id}-handed`}
        label="The order was handed over."
        checked={handedOver}
        onChange={setHandedOver}
        error={error}
      />
    </StaffActionDialog>
  )
}

function CompleteCashForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("complete", props)
  const due = props.order.finalAmountDuePaisa
  // Empty on purpose: the person enters the cash they actually counted.
  const [cash, setCash] = useState("")
  const [handedOver, setHandedOver] = useState(false)
  const [problems, setProblems] = useState<{ cash?: string; handed?: string }>({})

  function onSubmit() {
    const found: { cash?: string; handed?: string } = {}
    found.cash = amountProblem(cash, { allowZero: false }) ?? undefined
    const parsed = parsePkr(cash)
    if (!found.cash && parsed.ok && due !== undefined && parsed.paisa !== due) {
      found.cash = `The cash must equal the amount due, ${formatPaisa(due)}. Part payment, extra cash and credit can't be recorded. If the full amount wasn't paid, don't record the delivery here.`
    }
    if (!handedOver) found.handed = "Record this only after the order was handed over and the cash received."
    setProblems(found)
    if (found.cash || found.handed || !parsed.ok) return focusFirstProblem(id, ["cash", "handed"], found)
    void submit((signal) =>
      completeGroceryOrder(props.order.id, { revision, amountCollectedPaisa: parsed.paisa }, signal)
    )
  }

  return (
    <StaffActionDialog
      {...shell(props)}
      title="Record delivery and cash"
      description="Delivery and payment are recorded together, once. This can't be undone."
      submitLabel="Record delivered and paid"
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <AmountDue label="Amount due" paisa={due} />
      <AmountField id={`${id}-cash`} label="Cash you collected (Rs)" value={cash} onChange={setCash} error={problems.cash} />
      <CheckField
        id={`${id}-handed`}
        label="The order was handed over and I received this cash."
        checked={handedOver}
        onChange={setHandedOver}
        error={problems.handed}
      />
    </StaffActionDialog>
  )
}

function CompleteForm(props: StaffFormProps) {
  // Which of the two was opened stays: if the order changes underneath, the form is outdated.
  const [paid] = useState(Boolean(props.order.payment))
  return paid ? <CompletePaidForm {...props} /> : <CompleteCashForm {...props} />
}

function ReduceAmountForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("reduce_amount", props)
  const due = props.order.finalAmountDuePaisa
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [problems, setProblems] = useState<{ amount?: string; reason?: string }>({})
  const parsed = parsePkr(amount)
  const less = parsed.ok && due !== undefined && parsed.paisa > 0 && parsed.paisa < due ? due - parsed.paisa : null

  function onSubmit() {
    const found: { amount?: string; reason?: string } = {}
    found.amount = amountProblem(amount, { allowZero: false }) ?? undefined
    if (!found.amount && parsed.ok && due !== undefined && parsed.paisa >= due) {
      found.amount = `Enter less than the amount now due, ${formatPaisa(due)}. For a higher or changed price, record a new agreement.`
    }
    if (!reason.trim()) found.reason = "Write why the amount is lower."
    setProblems(found)
    if (found.amount || found.reason || !parsed.ok) return focusFirstProblem(id, ["amount", "reason"], found)
    void submit((signal) =>
      reduceGroceryAmount(props.order.id, { revision, finalAmountPaisa: parsed.paisa, reason: reason.trim() }, signal)
    )
  }

  return (
    <StaffActionDialog
      {...shell(props)}
      title="Lower the amount due"
      description="Only downwards, for example when an item couldn't be bought. The recorded agreement stays in the history. Tell the customer yourself."
      submitLabel="Lower amount"
      pendingLabel="Saving…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <AmountDue label="Amount due now" paisa={due} />
      <AmountField id={`${id}-amount`} label="New amount due (Rs)" value={amount} onChange={setAmount} error={problems.amount} />
      <div role="status" className="text-sm text-muted-foreground">
        {less === null ? "" : `This lowers the amount by ${formatPaisa(less)}.`}
      </div>
      <NoteField
        id={`${id}-reason`}
        label="Reason"
        oneLine
        hint="Internal."
        value={reason}
        onChange={setReason}
        maxLength={200}
        error={problems.reason}
      />
    </StaffActionDialog>
  )
}

function CancelForm(props: StaffFormProps) {
  const id = useId()
  const { revision, refusal, outdated, submit } = useStaffForm("cancel", props)
  // Buying may have started. The server lets only a Super Admin get this far.
  const [afterBuying] = useState(props.order.status === "preparing")
  const [reason, setReason] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [problems, setProblems] = useState<{ reason?: string; acknowledged?: string }>({})

  function onSubmit() {
    const found: { reason?: string; acknowledged?: string } = {}
    if (!reason.trim()) found.reason = "Write why the order is being cancelled."
    if (afterBuying && !acknowledged) found.acknowledged = "Confirm that goods may already have been bought."
    setProblems(found)
    if (found.reason || found.acknowledged) return focusFirstProblem(id, ["reason", "acknowledged"], found)
    void submit((signal) =>
      cancelGroceryOrderAsStaff(
        props.order.id,
        { revision, reason: reason.trim(), ...(afterBuying ? { procurementAcknowledged: true } : {}) },
        signal
      )
    )
  }

  return (
    <StaffActionDialog
      {...shell(props)}
      title={`Cancel order ${props.order.reference}?`}
      description="This can't be undone. The app doesn't send the customer a message: tell them yourself."
      submitLabel="Cancel this order"
      pendingLabel="Cancelling…"
      destructive
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <NoteField
        id={`${id}-reason`}
        label="Reason"
        oneLine
        hint="Internal. The customer sees only that the team cancelled the order."
        value={reason}
        onChange={setReason}
        maxLength={200}
        error={problems.reason}
      />
      {afterBuying && (
        <CheckField
          id={`${id}-acknowledged`}
          label="I understand that goods may already have been bought for this order."
          hint="No refund is created. An issue is left on the order for someone to resolve by hand."
          checked={acknowledged}
          onChange={setAcknowledged}
          error={problems.acknowledged}
        />
      )}
    </StaffActionDialog>
  )
}

function IssueForm(props: StaffFormProps) {
  const id = useId()
  const { refusal, outdated, submit } = useStaffForm("record_issue", props)
  const [kind, setKind] = useState<GroceryRecordableIssueDto | null>(null)
  const [note, setNote] = useState("")
  const [problems, setProblems] = useState<{ kind?: string; note?: string }>({})

  function onSubmit() {
    const found: { kind?: string; note?: string } = {}
    if (!kind) found.kind = "Choose what kind of issue it is."
    if (!note.trim()) found.note = "Describe what happened."
    setProblems(found)
    if (!kind || found.note) return focusFirstProblem(id, ["kind", "note"], found)
    void submit((signal) => recordGroceryIssue(props.order.id, { kind, note: note.trim() }, signal))
  }

  return (
    <StaffActionDialog
      {...shell(props)}
      title="Record an issue"
      description="For a person to follow up. It changes nothing else about the order, and the app has no way to mark it resolved."
      submitLabel="Record issue"
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
    >
      <ChoiceField
        id={`${id}-kind`}
        legend="Kind of issue"
        options={RECORDABLE_ISSUES.map((value) => ({ value, label: ISSUE_LABEL[value] }))}
        value={kind}
        onChange={setKind}
        error={problems.kind}
      />
      <NoteField
        id={`${id}-note`}
        label="What happened"
        hint="Internal. Customers don't see it."
        value={note}
        onChange={setNote}
        maxLength={500}
        error={problems.note}
      />
    </StaffActionDialog>
  )
}

/** The form for one action. `claim` has none: it is a single button. */
function StaffActionForm({ action, ...props }: StaffFormProps & { action: Exclude<GroceryStaffActionDto, "claim"> }) {
  switch (action) {
    case "confirm":
    case "reconfirm":
      return <AgreementForm action={action} {...props} />
    case "release":
      return <ReleaseForm {...props} />
    case "start_preparing":
      return <StartPreparingForm {...props} />
    case "dispatch":
      return <DispatchForm {...props} />
    case "delivery_failed":
      return <DeliveryFailedForm {...props} />
    case "complete":
      return <CompleteForm {...props} />
    case "reduce_amount":
      return <ReduceAmountForm {...props} />
    case "cancel":
      return <CancelForm {...props} />
    case "record_payment":
      return <RecordPaymentForm {...props} />
    case "record_refund":
      return <RefundForm {...props} />
    case "record_issue":
      return <IssueForm {...props} />
  }
}

export { StaffActionForm }
