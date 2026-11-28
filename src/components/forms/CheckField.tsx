import { Typography } from "@/components/foundation/Typography"
import { FieldError } from "@/components/forms/FieldError"

interface CheckFieldProps {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
  disabled?: boolean
}

/** One checkbox as a whole 44px row. Used for statements a person makes themselves: never ticked for them. */
function CheckField({ id, label, hint, checked, onChange, error, disabled }: CheckFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-input bg-card/60 px-3 py-2.5 text-base has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-60"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
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

export { CheckField }
