import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FieldError } from "@/components/forms/FieldError"
import { Typography } from "@/components/foundation/Typography"
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

interface CheckFieldProps {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
}

/** A statement the person makes themselves: never ticked in advance. */
function CheckField({ id, label, hint, checked, onChange, error }: CheckFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-input bg-card/60 px-3 py-2.5 text-base has-checked:border-primary has-checked:bg-accent"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, Boolean(hint))}
        />
        <span className="min-w-0">{label}</span>
      </label>
      {hint && (
        <Typography as="p" id={`${id}-hint`} variant="caption" className="text-muted-foreground">
          {hint}
        </Typography>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export { AmountField, CheckField, ChoiceField, NoteField }
