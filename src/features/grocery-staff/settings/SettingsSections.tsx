import { useState, type ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Typography } from "@/components/foundation/Typography"
import { CheckField } from "@/components/forms/CheckField"
import { FieldError } from "@/components/forms/FieldError"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass } from "@/features/grocery/fieldStyles"
import { AmountField } from "@/features/grocery-staff/StaffFields"
import {
  LIMITS,
  PAYMENT_METHODS,
  checkBlock,
  describeValue,
  draftKeyOf,
  withBlocks,
  type SettingsDraft,
  type SettingsProblems,
} from "@/features/grocery-staff/settings/settingsForm"
import { PAYMENT_METHOD_NAME } from "@/features/grocery/paymentCopy"
import type { GroceryPaymentMethodDto } from "@/lib/api/dto/grocery"
import type { GrocerySettingsDto, GrocerySettingsField } from "@/lib/api/dto/grocerySettings"

export interface SectionProps {
  /** The prefix of every field id (`${id}-${draftKey}`). */
  id: string
  draft: SettingsDraft
  /** The version on the server, for "Saved: …" under a changed field. */
  saved: GrocerySettingsDto
  changed: Set<GrocerySettingsField>
  problems: SettingsProblems
  disabled: boolean
  onChange: (patch: Partial<SettingsDraft>) => void
}

/** Shown under a field whose value differs from what is saved. */
function Saved({ field, saved, changed }: Pick<SectionProps, "saved" | "changed"> & { field: GrocerySettingsField }) {
  if (!changed.has(field)) return null
  return (
    <Typography as="p" variant="caption" className="font-medium text-warning-text" data-saved-for={draftKeyOf(field)}>
      Not saved yet. Saved now: {describeValue(field, saved[field])}
    </Typography>
  )
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass-panel flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <Typography as="h2" id={id} variant="h3" className="text-lg">
          {title}
        </Typography>
        {hint && (
          <Typography variant="body-sm" className="text-muted-foreground">
            {hint}
          </Typography>
        )}
      </div>
      {children}
    </section>
  )
}

function AvailabilitySection({ id, draft, saved, changed, disabled, onChange }: SectionProps) {
  return (
    <Section id={`${id}-availability`} title="Service availability">
      <CheckField
        id={`${id}-enabled`}
        label="Accept new grocery orders"
        hint="This alone doesn't open ordering: opening hours, a listed block and a free place for the day are also needed. Staff can handle existing orders either way."
        checked={draft.enabled}
        disabled={disabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      <Saved field="enabled" saved={saved} changed={changed} />
    </Section>
  )
}

function CoverageSection({ id, draft, saved, changed, problems, disabled, onChange }: SectionProps) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string>()
  const fieldId = `${id}-serviceableBlocks`

  function add() {
    const checked = checkBlock(text, draft.serviceableBlocks)
    if (!checked.ok) {
      setError(checked.message)
      document.getElementById(fieldId)?.focus()
      return
    }
    setError(undefined)
    setText("")
    onChange(withBlocks([...draft.serviceableBlocks, checked.label], saved))
    document.getElementById(fieldId)?.focus()
  }

  return (
    <Section
      id={`${id}-coverage`}
      title="Delivery coverage"
      hint="Customers can only order for a listed block. Add only blocks the team has verified; none is suggested here."
    >
      {draft.serviceableBlocks.length === 0 ? (
        <Typography variant="body-sm" className="rounded-xl bg-muted/60 p-3">
          No block is listed, so nobody can order.
        </Typography>
      ) : (
        <ul aria-label="Listed delivery blocks" className="flex flex-wrap gap-2">
          {draft.serviceableBlocks.map((block) => (
            <li key={block} className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-card/70 pl-3">
              <span className="min-w-0 break-words py-1 text-sm font-medium">{block}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`Remove block ${block}`}
                disabled={disabled}
                onClick={() => {
                  onChange(withBlocks(draft.serviceableBlocks.filter((other) => other !== block), saved))
                  document.getElementById(fieldId)?.focus()
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <GroceryField id={fieldId} label="Add a block" error={error} className="flex-1">
          <Input
            id={fieldId}
            autoComplete="off"
            maxLength={LIMITS.blockLength}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the block; it never saves the settings.
              if (event.key !== "Enter") return
              event.preventDefault()
              add()
            }}
            className={groceryInputClass}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(fieldId, error)}
          />
        </GroceryField>
        <Button type="button" variant="outline" className="mt-5 h-11" onClick={add} disabled={disabled}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </div>
      <Saved field="serviceableBlocks" saved={saved} changed={changed} />
      <CheckField
        id={`${id}-coversAllB17`}
        label="The listed blocks cover all sectors and blocks of B-17"
        hint="Tick only after checking the list against the official blocks. Customers are then told you deliver across all of B-17. Changing the list unticks this."
        checked={draft.coversAllB17}
        disabled={disabled || (draft.serviceableBlocks.length === 0 && !draft.coversAllB17)}
        onChange={(coversAllB17) => onChange({ coversAllB17 })}
        error={problems.coversAllB17}
      />
      <Saved field="coversAllB17" saved={saved} changed={changed} />
    </Section>
  )
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function ScheduleSection({ id, draft, saved, changed, problems, disabled, onChange }: SectionProps) {
  const daysId = `${id}-operatingDays`
  return (
    <Section
      id={`${id}-schedule`}
      title="Operating schedule"
      hint="Pakistan time (Asia/Karachi), which can't be changed. Orders are accepted from the opening time up to, but not including, the closing time."
    >
      <fieldset
        id={daysId}
        tabIndex={-1}
        className="flex min-w-0 flex-col gap-1.5"
        aria-describedby={problems.operatingDays ? `${daysId}-error` : undefined}
      >
        <legend className="mb-1.5 text-sm font-medium">Operating days</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WEEKDAYS.map((name, index) => (
            <CheckField
              key={name}
              id={`${daysId}-${index + 1}`}
              label={name}
              checked={draft.operatingDays.includes(index + 1)}
              disabled={disabled}
              onChange={(checked) =>
                onChange({
                  operatingDays: checked
                    ? [...draft.operatingDays, index + 1].sort((a, b) => a - b)
                    : draft.operatingDays.filter((day) => day !== index + 1),
                })
              }
            />
          ))}
        </div>
        <FieldError id={`${daysId}-error`} message={problems.operatingDays} />
      </fieldset>
      <Saved field="operatingDays" saved={saved} changed={changed} />
      <div className="grid grid-cols-2 gap-3">
        {(["opensAt", "closesAt"] as const).map((key) => (
          <div key={key} className="flex min-w-0 flex-col gap-1.5">
            <GroceryField
              id={`${id}-${key}`}
              label={key === "opensAt" ? "Opens at" : "Closes at"}
              hint={key === "closesAt" ? "12:00 AM means midnight, at the end of the day." : undefined}
              error={problems[key]}
            >
              <Input
                id={`${id}-${key}`}
                type="time"
                value={draft[key]}
                disabled={disabled}
                onChange={(event) => onChange({ [key]: event.target.value })}
                className={groceryInputClass}
                aria-invalid={problems[key] ? true : undefined}
                aria-describedby={describedBy(`${id}-${key}`, problems[key], key === "closesAt")}
              />
            </GroceryField>
            <Saved field={key} saved={saved} changed={changed} />
          </div>
        ))}
      </div>
    </Section>
  )
}

const COUNTS = [
  { key: "dailyCapacity", label: "Orders accepted per day", note: "Per Pakistan calendar day." },
  { key: "maxActiveOrdersPerCustomer", label: "Open orders per customer", note: "Not delivered or cancelled yet." },
  { key: "maxItemsPerOrder", label: "Items per order", note: "Lines on one list." },
] as const

function CapacitySection({ id, draft, saved, changed, problems, disabled, onChange }: SectionProps) {
  return (
    <Section id={`${id}-capacity`} title="Capacity and order limits">
      <div className="grid gap-3 sm:grid-cols-3">
        {COUNTS.map(({ key, label, note }) => {
          const fieldId = `${id}-${key}`
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <GroceryField id={fieldId} label={label} hint={`${LIMITS[key].min} to ${LIMITS[key].max}. ${note}`} error={problems[key]}>
                <Input
                  id={fieldId}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={draft[key]}
                  disabled={disabled}
                  onChange={(event) => onChange({ [key]: event.target.value })}
                  className={groceryInputClass}
                  aria-invalid={problems[key] ? true : undefined}
                  aria-describedby={describedBy(fieldId, problems[key], true)}
                />
              </GroceryField>
              <Saved field={key} saved={saved} changed={changed} />
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function FinancialSection({ id, draft, saved, changed, problems, disabled, onChange }: SectionProps) {
  return (
    <Section
      id={`${id}-financial`}
      title="Financial limit"
      hint="The largest total, fees included, that staff can record as agreed. It is checked every time an agreement is recorded, for existing orders too."
    >
      <fieldset disabled={disabled} className="min-w-0">
        <AmountField
          id={`${id}-maxOrderValue`}
          label="Largest order total (Rs)"
          value={draft.maxOrderValue}
          onChange={(maxOrderValue) => onChange({ maxOrderValue })}
          error={problems.maxOrderValue}
        />
      </fieldset>
      <Saved field="maxOrderValuePaisa" saved={saved} changed={changed} />
    </Section>
  )
}

const METHOD_HINT: Record<GroceryPaymentMethodDto, string> = {
  cash_on_delivery: "Always offered.",
  card: "Taken on the business's card machine at delivery. No card details are entered in this app.",
  bank_transfer: "A transfer to the business account, checked by staff.",
  easypaisa: "A payment to the business Easypaisa account, checked by staff.",
  jazzcash: "A payment to the business JazzCash account, checked by staff.",
}

function PaymentMethodsSection({ id, draft, saved, changed, disabled, onChange }: SectionProps) {
  return (
    <Section
      id={`${id}-payment-methods`}
      title="Payment methods"
      hint="What customers are told they can pay with, and what staff can record. Switch a method on only once its account or card machine is ready. This app holds no account numbers: staff give them to customers."
    >
      <fieldset id={`${id}-paymentMethods`} tabIndex={-1} className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Payment methods offered</legend>
        {PAYMENT_METHODS.map((method) => (
          <CheckField
            key={method}
            id={`${id}-paymentMethods-${method}`}
            label={PAYMENT_METHOD_NAME[method]}
            hint={METHOD_HINT[method]}
            checked={method === "cash_on_delivery" || draft.paymentMethods.includes(method)}
            disabled={disabled || method === "cash_on_delivery"}
            onChange={(checked) =>
              onChange({
                paymentMethods: PAYMENT_METHODS.filter((other) =>
                  other === method ? checked : draft.paymentMethods.includes(other)
                ),
              })
            }
          />
        ))}
      </fieldset>
      <Saved field="paymentMethods" saved={saved} changed={changed} />
    </Section>
  )
}

export { AvailabilitySection, CapacitySection, CoverageSection, FinancialSection, PaymentMethodsSection, ScheduleSection }
