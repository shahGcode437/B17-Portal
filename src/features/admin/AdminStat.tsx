import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card"

interface AdminStatProps {
  /** The status badge for this count (so the dashboard speaks the same status language as the lists). */
  badge: ReactNode
  /** Accessible link name, e.g. "Pending Review listings". */
  linkLabel: string
  value: number
  to: string
}

/** Compact dashboard count: status badge + real number, the whole tile links to where those records live. */
function AdminStat({ badge, linkLabel, value, to }: AdminStatProps) {
  return (
    <Card
      variant="workspace"
      className="relative gap-1 p-3 transition-colors hover:border-primary/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
    >
      <Link to={to} aria-label={`${linkLabel}: ${value}`} className="w-fit outline-none after:absolute after:inset-0 after:rounded-xl">
        {badge}
      </Link>
      <span aria-hidden="true" className="font-heading text-2xl font-semibold leading-tight">
        {value}
      </span>
    </Card>
  )
}

export { AdminStat }
