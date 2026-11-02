import type { ReactNode } from "react"
import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

type FormAlertTone = "info" | "warning" | "error"

interface FormAlertProps {
  tone?: FormAlertTone
  /** The role to announce under. `alert` for submission failures, `status` for passive context. */
  role?: "alert" | "status"
  title: string
  description?: ReactNode
  /** Optional one-line follow-up action link (e.g. "Manage my listings"). */
  action?: ReactNode
  className?: string
}

const TONE_CLASS: Record<FormAlertTone, { bg: string; ring: string; icon: string; title: string; Icon: typeof CircleAlert }> = {
  info: {
    bg: "bg-info/10",
    ring: "ring-info/25",
    icon: "bg-info/15 text-info-text",
    title: "text-foreground",
    Icon: Info,
  },
  warning: {
    bg: "bg-warning/10",
    ring: "ring-warning/25",
    icon: "bg-warning/15 text-warning-text",
    title: "text-foreground",
    Icon: TriangleAlert,
  },
  error: {
    bg: "bg-destructive/10",
    ring: "ring-destructive/25",
    icon: "bg-destructive/15 text-destructive",
    title: "text-destructive",
    Icon: CircleAlert,
  },
}

/**
 * One coherent form-level alert (VR5): tonal glass panel + icon tile + title + optional description + optional
 * follow-up action link. Replaces the ad-hoc `rounded-lg bg-destructive/5 px-3 py-2 text-destructive` fragments
 * sprinkled across the form family so every create / edit / resubmit surface speaks the same visual language.
 * Status text comes with the icon, so meaning is never conveyed by color alone.
 */
function FormAlert({ tone = "error", role = "alert", title, description, action, className }: FormAlertProps) {
  const tc = TONE_CLASS[tone]
  const { Icon } = tc
  return (
    <div className={cn("flex items-start gap-3 rounded-xl p-3.5 ring-1 sm:p-4", tc.bg, tc.ring, className)}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", tc.icon)} aria-hidden="true">
        <Icon className="size-4.5" />
      </span>
      <Typography
        as="p"
        variant="body-sm"
        role={role}
        className={cn("min-w-0 flex-1 font-medium", tc.title)}
      >
        {title}{description ? ` — ${description}` : ""}
        {action ? <span className="mt-2 block font-normal text-foreground">{action}</span> : null}
      </Typography>
    </div>
  )
}

export { FormAlert }
export type { FormAlertTone }
