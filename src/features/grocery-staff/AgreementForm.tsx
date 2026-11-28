import { useId, useState } from "react"
import { Typography } from "@/components/foundation/Typography"
import { formatPaisa } from "@/features/grocery/format"
import { CheckField } from "@/components/forms/CheckField"
import { AmountField, ChoiceField, NoteField } from "@/features/grocery-staff/StaffFields"
import { StaffActionDialog } from "@/features/grocery-staff/StaffActionDialog"
import { useStaffForm, type StaffFormProps } from "@/features/grocery-staff/useStaffForm"
import { amountProblem, paisaToInput, parsePkr } from "@/features/grocery-staff/money"
import { focusFirstProblem } from "@/features/grocery-staff/fieldFocus"
import { METHOD_OPTIONS } from "@/features/grocery-staff/staffLabels"
import { confirmGroceryOrder, reconfirmGroceryOrder } from "@/lib/api/writes/groceryStaff"
import type { GroceryConfirmationMethodDto } from "@/lib/api/dto/grocery"

const FIELDS = ["items", "service", "delivery", "total", "method", "substitutions", "consent", "agreed"]

type Problems = Partial<Record<string, string>>

/**
 * "The customer agreed to this" as a STAFF MEMBER records it, for the first agreement (`confirm`) and
 * every later one (`reconfirm`). The total is typed, not filled in: it is the figure the customer was
 * told, and it must equal the parts. How they agreed, whether they accepted any substitute and the
 * statement that they agreed are never chosen in advance.
 */
function AgreementForm({ action, ...props }: StaffFormProps & { action: "confirm" | "reconfirm" }) {
  const id = useId()
  const again = action === "reconfirm"
  const { revision, refusal, outdated, submit } = useStaffForm(action, props)
  const previous = props.order.confirmations.at(-1)
  // A new agreement starts from the last recorded amounts, which are usually what changes a little.
  const [items, setItems] = useState(previous ? paisaToInput(previous.itemsSubtotalPaisa) : "")
  const [service, setService] = useState(previous ? paisaToInput(previous.serviceFeePaisa) : "0")
  const [delivery, setDelivery] = useState(previous ? paisaToInput(previous.deliveryFeePaisa) : "0")
  const [total, setTotal] = useState("")
  const [method, setMethod] = useState<GroceryConfirmationMethodDto | null>(null)
  const [substitutions, setSubstitutions] = useState<"yes" | "no" | null>(null)
  const [consent, setConsent] = useState("")
  const [pricing, setPricing] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [problems, setProblems] = useState<Problems>({})

  const parts = [parsePkr(items), parsePkr(service), parsePkr(delivery)]
  const sum = parts.every((part) => part.ok) ? parts.reduce((total_, part) => total_ + (part.ok ? part.paisa : 0), 0) : null
  const consentRequired = again || substitutions === "yes"

  function check(): Problems {
    const found: Problems = {}
    found.items = amountProblem(items, { allowZero: false }) ?? undefined
    found.service = amountProblem(service, { allowZero: true }) ?? undefined
    found.delivery = amountProblem(delivery, { allowZero: true }) ?? undefined
    found.total = amountProblem(total, { allowZero: false }) ?? undefined
    const typed = parsePkr(total)
    if (!found.total && typed.ok && sum !== null && typed.paisa !== sum) {
      found.total = `This doesn't equal the items plus the fees (${formatPaisa(sum)}).`
    }
    if (!method) found.method = "Choose how the customer agreed."
    if (!substitutions) found.substitutions = "Say whether the customer agreed to any substitute."
    if (consentRequired && !consent.trim()) {
      found.consent = again
        ? "Write what the customer newly agreed to."
        : "Write which substitutes the customer agreed to."
    }
    if (!agreed) found.agreed = "Record an agreement only after the customer has agreed."
    return found
  }

  function onSubmit() {
    const found = check()
    setProblems(found)
    if (Object.values(found).some(Boolean)) {
      focusFirstProblem(id, FIELDS, found)
      return
    }
    const [itemsPaisa, servicePaisa, deliveryPaisa] = [items, service, delivery].map(paisaOf)
    const note = consent.trim()
    const pricingNote = pricing.trim()
    const body = {
      revision,
      itemsSubtotalPaisa: itemsPaisa,
      serviceFeePaisa: servicePaisa,
      deliveryFeePaisa: deliveryPaisa,
      agreedTotalPaisa: paisaOf(total),
      customerAgreed: true as const,
      method: method!,
      substitutionsAgreed: substitutions === "yes",
      ...(pricingNote ? { pricingNote } : {}),
      ...(note ? { consentNote: note } : {}),
    }
    void submit((signal) =>
      again
        ? reconfirmGroceryOrder(props.order.id, { ...body, consentNote: note }, signal)
        : confirmGroceryOrder(props.order.id, body, signal)
    )
  }

  return (
    <StaffActionDialog
      title={again ? "Record a new agreement" : "Record the customer's agreement"}
      description="This records what the customer told you. It is not an approval given by the customer in the app, and they will see the total as recorded by the team."
      submitLabel={again ? "Record new agreement" : "Confirm order"}
      pendingLabel="Recording…"
      refusal={refusal}
      outdated={outdated}
      onSubmit={onSubmit}
      pending={props.pending}
      onClose={props.onClose}
      pageExplains={props.pageExplains}
    >
      {again && previous && (
        <Typography variant="body-sm" className="rounded-xl bg-muted/60 p-3">
          Last recorded total: <span className="font-semibold">{formatPaisa(previous.totalPaisa)}</span>. It stays in the
          order's history.
        </Typography>
      )}
      <AmountField id={`${id}-items`} label="Items (Rs)" value={items} onChange={setItems} error={problems.items} />
      <div className="grid grid-cols-2 gap-3">
        <AmountField id={`${id}-service`} label="Service fee (Rs)" value={service} onChange={setService} error={problems.service} />
        <AmountField id={`${id}-delivery`} label="Delivery fee (Rs)" value={delivery} onChange={setDelivery} error={problems.delivery} />
      </div>
      <div role="status" className="flex justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
        <span>Items plus fees</span>
        <span className="font-semibold tabular-nums">{sum === null ? "—" : formatPaisa(sum)}</span>
      </div>
      <AmountField id={`${id}-total`} label="Total the customer agreed to (Rs)" value={total} onChange={setTotal} error={problems.total} />
      <ChoiceField
        id={`${id}-method`}
        legend="How did the customer agree?"
        options={METHOD_OPTIONS}
        value={method}
        onChange={setMethod}
        error={problems.method}
      />
      <ChoiceField
        id={`${id}-substitutions`}
        legend="Did the customer agree to any substitute?"
        options={[
          { value: "yes", label: "Yes, they agreed to a substitute" },
          { value: "no", label: "No substitute was agreed" },
        ]}
        value={substitutions}
        onChange={setSubstitutions}
        error={problems.substitutions}
      />
      <NoteField
        id={`${id}-consent`}
        label={again ? "What the customer newly agreed to" : substitutions === "yes" ? "Which substitutes they agreed to" : "Note on the agreement"}
        optional={!consentRequired}
        hint="Internal. Customers don't see this note."
        value={consent}
        onChange={setConsent}
        maxLength={500}
        error={problems.consent}
      />
      <NoteField
        id={`${id}-pricing`}
        label="Pricing note"
        optional
        oneLine
        hint="Internal."
        value={pricing}
        onChange={setPricing}
        maxLength={200}
      />
      <CheckField
        id={`${id}-agreed`}
        label="I spoke with the customer, and they agreed to these items and this total."
        checked={agreed}
        onChange={setAgreed}
        error={problems.agreed}
      />
    </StaffActionDialog>
  )
}

/** Only called for a field that has passed `amountProblem`. */
function paisaOf(text: string): number {
  const parsed = parsePkr(text)
  if (!parsed.ok) throw new Error("amount not checked")
  return parsed.paisa
}

export { AgreementForm }
