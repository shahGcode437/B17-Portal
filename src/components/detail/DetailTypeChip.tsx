import type { LucideIcon } from "lucide-react"

interface DetailTypeChipProps {
  icon: LucideIcon
  /** What kind of listing this is, or for a property whether it is for sale or rent. Shown once per page. */
  label: string
}

/** A glass chip over the hero image that says what kind of listing this is. */
function DetailTypeChip({ icon: Icon, label }: DetailTypeChipProps) {
  return (
    <span className="glass-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-foreground">
      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      {label}
    </span>
  )
}

export { DetailTypeChip }
