import { Input } from "@/components/ui/input"
import { Typography } from "@/components/foundation/Typography"
import { Textarea } from "@/components/ui/textarea"
import { FieldError } from "@/components/forms/FieldError"
import { GroceryField } from "@/features/grocery/GroceryField"
import { describedBy, groceryInputClass } from "@/features/grocery/fieldStyles"
import { formatPaisa } from "@/features/grocery/format"
import { parsePkr } from "@/features/grocery-staff/money"

interface AmountFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}

/** An amount in rupees. What the app understood is shown back underneath. */
function AmountField({ id, label, value, onChange, error }: AmountFieldProps) {
  const parsed = parsePkr(value)
  return (
    <GroceryField id={id} label={label} error={error} hint={parsed.ok ? `= ${formatPaisa(parsed.paisa)}` : "In rupees."}>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={groceryInputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, true)}
      />
    </GroceryField>
  )
}

interface NoteFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  optional?: boolean
  hint?: string
  error?: string
  /** The server accepts one line only: new lines become spaces. */
  oneLine?: boolean
}

function NoteField({ id, label, value, onChange, maxLength, optional, hint, error, oneLine }: NoteFieldProps) {
  return (
    <GroceryField id={id} label={label} optional={optional} hint={hint} error={error}>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(oneLine ? event.target.value.replace(/[\r\n]+/g, " ") : event.target.value)}
        maxLength={maxLength}
        rows={2}
        className="min-h-20 text-base md:text-base"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, Boolean(hint))}
      />
    </GroceryField>
  )
}

interface ChoiceFieldProps<T extends string> {
  id: string
  legend: string
  options: { value: T; label: string }[]
  /** `null` until the person chooses: nothing is ever chosen for them. */
  value: T | null
  onChange: (value: T) => void
  error?: string
}

function ChoiceField<T extends string>({ id, legend, options, value, onChange, error }: ChoiceFieldProps<T>) {
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card/60 px-3 py-2 text-base has-checked:border-primary has-checked:bg-accent"
        >
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0">{option.label}</span>
        </label>
      ))}
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  )
}

/** The figure a form is about, shown above its fields. */
function AmountDue({ label, paisa }: { label: string; paisa: number | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-primary/8 px-3 py-2.5 ring-1 ring-primary/20">
      <Typography as="span" variant="body-sm">
        {label}
      </Typography>
      <Typography as="span" variant="label" className="text-lg tabular-nums">
        {paisa === undefined ? "Not recorded" : formatPaisa(paisa)}
      </Typography>
    </div>
  )
}

export { AmountDue, AmountField, ChoiceField, NoteField }
