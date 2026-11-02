import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

interface FormSectionProps {
  /** Short section title. */
  title: string
  /** One-line helper that explains what this section is for. */
  description?: string
  /** A small icon tile beside the title (operational, not decorative). */
  icon?: LucideIcon
  /** Section number for ordered sections (e.g. "1" / "2" / …). */
  step?: number | string
  /** The grouped controls — stacked and separated with rhythm. */
  children: ReactNode
  /** Use `<fieldset>` + `<legend>` when the section wraps a native-form group of radios / checkboxes. */
  as?: "section" | "fieldset"
  /** aria-labelledby target id when the parent needs to reference this section's heading. */
  id?: string
  className?: string
}

/**
 * One sectioned block of a listing form (VR5). An opaque glass panel with an icon tile, a strong title, a quiet
 * helper line and a grouped set of controls. Dense forms sit on `glass-panel` so inputs stay readable; nesting
 * is intentionally shallow so there is never glass-on-glass-on-glass inside a form. When the children are a
 * native radio / checkbox group, pass `as="fieldset"` so the heading becomes a `<legend>` — the a11y pattern
 * `<fieldset>` + `<legend>` already groups the controls for assistive tech.
 */
function FormSection({ title, description, icon: Icon, step, children, as = "section", id, className }: FormSectionProps) {
  const Container = as
  const headerVisual = (
    <div className="flex items-start gap-3">
      {(step !== undefined || Icon) && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
          {step !== undefined ? (
            <span className="font-heading text-sm font-semibold tabular-nums">{step}</span>
          ) : Icon ? (
            <Icon className="size-5" aria-hidden="true" />
          ) : null}
        </span>
      )}
      <div className="flex flex-1 flex-col gap-1">
        <Typography as="span" variant="label" className="font-heading text-base font-semibold">
          {title}
        </Typography>
        {description && (
          <Typography as="span" variant="body-sm" className="text-muted-foreground">
            {description}
          </Typography>
        )}
      </div>
    </div>
  )

  if (as === "fieldset") {
    // The <legend> is the fieldset's accessible name; keep it as the plain title so the group reads as the title
    // alone (no icon alt text, no description). The visible header is the standard icon-tile layout.
    return (
      <fieldset id={id} className={cn("glass-panel flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5", className)}>
        <legend className="sr-only">{title}</legend>
        {headerVisual}
        <div className="flex flex-col gap-4">{children}</div>
      </fieldset>
    )
  }

  return (
    <Container id={id} className={cn("glass-panel flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5", className)}>
      <h2 className="sr-only">{title}</h2>
      <div aria-hidden="true">{headerVisual}</div>
      <div className="flex flex-col gap-4">{children}</div>
    </Container>
  )
}

export { FormSection }
