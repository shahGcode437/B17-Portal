import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { Typography } from "@/components/foundation/Typography"
import { FieldError } from "@/components/forms/FieldError"
import { cn } from "@/lib/utils"

interface GroceryFieldProps {
  id: string
  label: string
  /** Shown after the label, quietly. */
  optional?: boolean
  hint?: ReactNode
  error?: string
  className?: string
  children: ReactNode
}

/** One labelled control with its hint and error, wired by id (the control sets `aria-describedby`). */
function GroceryField({ id, label, optional, hint, error, className, children }: GroceryFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {hint && (
        <Typography as="p" id={`${id}-hint`} variant="caption" className="text-muted-foreground">
          {hint}
        </Typography>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export { GroceryField }
