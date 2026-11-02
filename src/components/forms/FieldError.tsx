import { CircleAlert } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

interface FieldErrorProps {
  /** The id that `aria-describedby` on the field points to. */
  id: string
  /** The error message. Renders nothing when absent. */
  message?: string | null
  className?: string
}

/**
 * One coherent field-error line (VR5): red icon + bold text, strict `role="alert"`, visible without relying on color
 * alone. Replaces the ad-hoc `text-destructive` captions used across the form family so every inline validation
 * message speaks the same visual language and announces identically to assistive tech.
 */
function FieldError({ id, message, className }: FieldErrorProps) {
  if (!message) return null
  return (
    <div className={cn("flex items-start gap-1.5", className)}>
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <Typography
        id={id}
        as="p"
        variant="body-sm"
        role="alert"
        className="min-w-0 font-medium text-destructive"
      >
        {message}
      </Typography>
    </div>
  )
}

export { FieldError }
