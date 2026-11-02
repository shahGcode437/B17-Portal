import type { ReactNode } from "react"
import { motion } from "motion/react"
import { ClipboardList, Heart, Info, Loader2, MapPin, Search, TriangleAlert } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { Typography } from "@/components/foundation/Typography"
import { site } from "@/data/site"
import { duration, easing, fadeUp } from "@/lib/motion"
import { cn } from "@/lib/utils"

/** What a signed-in visitor can do: every line is true today, and none promises delivery, availability or contact. */
const BENEFITS = [
  { icon: Search, text: "Browse services, businesses, tutors, property and news. No sign-in needed." },
  { icon: Heart, text: "Save listings to find them again later." },
  { icon: ClipboardList, text: "Send service requests to local providers." },
] as const

/**
 * The brand side of the sign-in screens (VR3), shown from `lg` only: below that a split layout would only shrink
 * the form, so phones and tablets get the glass panel alone. Decorative composition: an emerald field, a faint
 * sector grid (B-17 is laid out on one) and a glow, with approved site copy and three true statements.
 */
function AuthBrandPanel({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.detail, ease: easing.enter }}
      className={cn(
        "relative flex-col justify-between gap-10 overflow-hidden rounded-3xl p-10 text-white shadow-elevated",
        "bg-[linear-gradient(150deg,color-mix(in_srgb,var(--primary)_82%,#001a12),color-mix(in_srgb,var(--primary)_52%,#02202c))]",
        className
      )}
    >
      <span aria-hidden="true" className="grid-lines absolute inset-0 opacity-60" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.22),transparent_65%)]"
      />
      <div className="relative flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
          <MapPin className="size-5" aria-hidden="true" />
        </span>
        <span className="font-heading text-xl font-semibold">{site.name}</span>
      </div>

      <div className="relative flex flex-col gap-6">
        <p className="font-heading text-4xl font-bold leading-tight tracking-tight text-balance">{site.tagline}</p>
        <ul className="flex flex-col gap-3.5">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-base leading-snug text-white/90">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium ring-1 ring-white/25">
        <MapPin className="size-4" aria-hidden="true" />
        B-17, Islamabad
      </span>
    </motion.div>
  )
}

interface AuthShellProps {
  children: ReactNode
  /** The brand panel beside the form (from `lg`). Off for the focused result screens and Admin Login. */
  brand?: boolean
}

/**
 * Shared frame for every sign-in screen (VR3): the atmospheric canvas with a restrained glow, an elevated Level-3
 * glass panel for the form and, from `lg`, the brand panel beside it. The form panel comes first in the DOM, so
 * keyboard and screen-reader users reach the form before decoration; `lg:order-first` only moves it visually.
 */
function AuthShell({ children, brand = true }: AuthShellProps) {
  return (
    <div className="relative">
      <div className="glow-field absolute inset-x-0 top-0 h-80" aria-hidden="true" />
      <Container className="relative py-10 sm:py-14 lg:py-20">
        <div
          className={cn(
            "mx-auto grid max-w-md gap-8 md:max-w-lg",
            brand && "lg:max-w-5xl lg:grid-cols-[1.05fr_1fr] lg:items-stretch"
          )}
        >
          <motion.div {...fadeUp} className="glass-3 rounded-3xl p-6 sm:p-8">
            {children}
          </motion.div>
          {brand && <AuthBrandPanel className="hidden lg:order-first lg:flex" />}
        </div>
      </Container>
    </div>
  )
}

interface AuthNoticeProps {
  /** "info" for a calm status, "error" for something that went wrong. */
  tone?: "info" | "error"
  role: "status" | "alert"
  children: ReactNode
}

/** A notice inside the auth panel. The caller owns the live-region role, so announcements are unchanged. */
function AuthNotice({ tone = "info", role, children }: AuthNoticeProps) {
  const Icon = tone === "error" ? TriangleAlert : Info
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3",
        tone === "error" ? "bg-destructive/10 ring-1 ring-destructive/25" : "bg-muted/70 ring-1 ring-border"
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** The "checking your session" state: a calm glass card, announced as a status, never a redirect or a flash of the form. */
function AuthLoading({ label = "Checking your session" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50svh] items-center justify-center px-4 py-16">
      <div className="glass-3 flex items-center gap-3 rounded-2xl px-6 py-4">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
        <Typography variant="body-sm" className="text-muted-foreground">
          {label}
        </Typography>
      </div>
    </div>
  )
}

export { AuthShell, AuthNotice, AuthLoading }
